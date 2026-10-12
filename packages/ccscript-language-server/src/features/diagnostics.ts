import { Diagnostic, DiagnosticSeverity as LspSeverity, Range } from 'vscode-languageserver/node';
import { DiagnosticSeverity, SyntaxKind } from 'ccscript-core';
import { importInfo } from '../symbols';
import { Analysis, Workspace } from '../workspace';

/** Diagnostic codes, used by quick fixes */
export const DiagnosticCodes = {
    syntax: 'syntax',
    undefinedName: 'undefined-name',
    unknownModule: 'unknown-module',
    unknownMember: 'unknown-member',
    duplicate: 'duplicate',
    unresolvedImport: 'unresolved-import',
    semantic: 'semantic',
} as const;

function semanticCode(message: string): string {
    if (/^Undefined (command|identifier) '/.test(message)) return DiagnosticCodes.undefinedName;
    if (message.startsWith('Unknown module')) return DiagnosticCodes.unknownModule;
    if (/' has no member '/.test(message)) return DiagnosticCodes.unknownMember;
    if (message.startsWith('Duplicate declaration')) return DiagnosticCodes.duplicate;
    return DiagnosticCodes.semantic;
}

function toLspSeverity(severity: DiagnosticSeverity | 'error' | 'warning' | 'info'): LspSeverity {
    switch (severity) {
        case DiagnosticSeverity.Error:
        case 'error':
            return LspSeverity.Error;
        case DiagnosticSeverity.Warning:
        case 'warning':
            return LspSeverity.Warning;
        default:
            return LspSeverity.Information;
    }
}

export function computeDiagnostics(workspace: Workspace, analysis: Analysis): Diagnostic[] {
    const { document, tree, module, filePath } = analysis;
    const range = (start: number, length: number) =>
        Range.create(document.positionAt(start), document.positionAt(start + length));

    const diagnostics: Diagnostic[] = [];

    for (const d of tree.getDiagnostics()) {
        diagnostics.push({
            range: range(d.span.start, d.span.length),
            severity: toLspSeverity(d.severity),
            message: d.message,
            source: 'ccscript',
            code: DiagnosticCodes.syntax,
        });
    }

    for (const d of workspace.program.getSemanticDiagnostics(module)) {
        diagnostics.push({
            range: range(d.position, d.length),
            severity: toLspSeverity(d.severity),
            message: d.message,
            source: 'ccscript',
            code: semanticCode(d.message),
        });
    }

    // Import problems, placed on the import statement they came from
    const imports = tree.getStatements()
        .filter(s => s.kind === SyntaxKind.ImportStatement)
        .map(s => importInfo(s))
        .filter(info => !!info);
    for (const d of workspace.program.getDiagnostics()) {
        if (d.filePath !== filePath || !d.importPath) {
            continue;
        }
        const statement = imports.find(info => info.path === d.importPath);
        diagnostics.push({
            range: statement ? range(statement.token.span.start, statement.token.span.length) : range(0, 0),
            severity: toLspSeverity(d.severity),
            message: d.message,
            source: 'ccscript',
            code: DiagnosticCodes.unresolvedImport,
        });
    }

    return diagnostics;
}
