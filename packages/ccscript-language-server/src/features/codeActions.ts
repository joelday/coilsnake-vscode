import {
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    Diagnostic,
    Range,
    TextEdit,
} from 'vscode-languageserver/node';
import { SymbolKind, SyntaxKind } from 'ccscript-core';
import { DiagnosticCodes } from './diagnostics';
import { importInsertion, importPath } from '../imports';
import { provideConvertActions } from './convertControlCodes';
import { Analysis, Workspace } from '../workspace';

const MAX_IMPORT_SUGGESTIONS = 5;
const MAX_SPELLING_SUGGESTIONS = 3;

/**
 * Case-insensitive edit distance, counting a swap of adjacent characters as one edit
 * (optimal string alignment).
 */
function editDistance(a: string, b: string): number {
    a = a.toLowerCase();
    b = b.toLowerCase();
    const rows = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
            }
        }
    }
    return rows[a.length][b.length];
}

function similarNames(name: string, candidates: Iterable<string>): string[] {
    const limit = Math.max(1, Math.floor(name.length / 3));
    return [...new Set(candidates)]
        .map(candidate => ({ candidate, distance: editDistance(name, candidate) }))
        .filter(c => c.distance > 0 && c.distance <= limit)
        .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
        .slice(0, MAX_SPELLING_SUGGESTIONS)
        .map(c => c.candidate);
}

function fixUndefinedName(workspace: Workspace, analysis: Analysis, diagnostic: Diagnostic, name: string): CodeAction[] {
    const actions: CodeAction[] = [];
    const { program } = workspace;
    const uri = analysis.uri;

    // Modules that declare the name at the top level
    const declaring = program.getAllModules().filter(m =>
        m.filePath !== analysis.filePath &&
        program.getModuleDeclarations(m).getAll(name).some(s => s.scopeId === 0 && s.kind !== SymbolKind.Module)
    ).slice(0, MAX_IMPORT_SUGGESTIONS);

    const insertion = importInsertion(analysis);
    for (const module of declaring) {
        const alreadyImported = analysis.module.dependencies.some(d => d.filePath === module.filePath);
        if (!alreadyImported) {
            const path = importPath(workspace, analysis, module);
            actions.push({
                title: `Import "${path}"`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                isPreferred: declaring.length === 1,
                edit: {
                    changes: {
                        [uri]: [TextEdit.insert(insertion.position, `${insertion.prefix}import "${path}"${insertion.suffix}`)],
                    },
                },
            });
        }
        actions.push({
            title: `Change to '${module.name}.${name}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: { changes: { [uri]: [TextEdit.replace(diagnostic.range, `${module.name}.${name}`)] } },
        });
    }

    // Likely typos of visible names
    const visible = analysis.binding.symbols.getAllSymbols()
        .filter(s => s.kind !== SymbolKind.Module)
        .map(s => s.name);
    for (const suggestion of similarNames(name, visible)) {
        actions.push({
            title: `Change to '${suggestion}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: { changes: { [uri]: [TextEdit.replace(diagnostic.range, suggestion)] } },
        });
    }
    return actions;
}

function fixUnknownMember(workspace: Workspace, analysis: Analysis, diagnostic: Diagnostic, moduleName: string, member: string): CodeAction[] {
    const target = workspace.program.getModuleByName(moduleName);
    if (!target) {
        return [];
    }
    // Replace just the member of the qualified name the diagnostic is on
    const token = analysis.tree.getTokenAtPosition(analysis.document.offsetAt(diagnostic.range.start));
    const qualified = token?.parent;
    if (!qualified || qualified.kind !== SyntaxKind.QualifiedNameExpression) {
        return [];
    }
    const memberToken = qualified.getChildren()[2];
    const range = Range.create(
        analysis.document.positionAt(memberToken.span.start),
        analysis.document.positionAt(memberToken.span.start + memberToken.span.length)
    );
    const members = workspace.program.getModuleDeclarations(target).getAllSymbols()
        .filter(s => s.scopeId === 0 && s.kind !== SymbolKind.Module)
        .map(s => s.name);
    return similarNames(member, members).map(suggestion => ({
        title: `Change to '${moduleName}.${suggestion}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [analysis.uri]: [TextEdit.replace(range, suggestion)] } },
    }));
}

export function provideCodeActions(workspace: Workspace, analysis: Analysis, params: CodeActionParams): CodeAction[] {
    const actions: CodeAction[] = [];
    const only = params.context.only;
    const wantsQuickFixes = !only || only.some(o => CodeActionKind.QuickFix === o || CodeActionKind.QuickFix.startsWith(`${o}.`));
    for (const diagnostic of wantsQuickFixes ? params.context.diagnostics : []) {
        if (diagnostic.source !== 'ccscript') {
            continue;
        }
        const message = typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value;
        if (diagnostic.code === DiagnosticCodes.undefinedName) {
            const name = message.match(/'([^']+)'/)?.[1];
            if (name) actions.push(...fixUndefinedName(workspace, analysis, diagnostic, name));
        } else if (diagnostic.code === DiagnosticCodes.unknownMember) {
            const match = message.match(/^'([^']+)' has no member '([^']+)'/);
            if (match) actions.push(...fixUnknownMember(workspace, analysis, diagnostic, match[1], match[2]));
        }
    }
    actions.push(...provideConvertActions(workspace, analysis, params.range, params.context.only));
    return actions;
}
