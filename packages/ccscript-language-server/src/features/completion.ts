import {
    CompletionItem,
    CompletionItemKind,
    CompletionParams,
    CompletionTriggerKind,
    InsertTextFormat,
    MarkupKind,
} from 'vscode-languageserver/node';
import { Symbol, SymbolKind, SyntaxKind, isRedToken } from 'ccscript-core';
import { labelTextResolver } from '../gameData';
import { DOMAIN_TITLES, Domain, domainOfParameter } from '../projectData';
import { findCall } from './signatureHelp';
import { describeSymbol, getDocComment, getParameterNames } from '../symbols';
import { Analysis, Workspace } from '../workspace';

const KEYWORDS = [
    'command', 'define', 'import', 'if', 'else', 'menu', 'default', 'flag', 'not', 'and', 'or',
    'byte', 'short', 'long', 'count', 'setcount', 'insertbin', 'ROM', 'ROMTBL',
];

export interface CompletionOptions {
    snippetSupport: boolean;
}

function completionKind(kind: SymbolKind): CompletionItemKind {
    switch (kind) {
        case SymbolKind.Command: return CompletionItemKind.Function;
        case SymbolKind.Constant: return CompletionItemKind.Constant;
        case SymbolKind.Label: return CompletionItemKind.Reference;
        case SymbolKind.Module: return CompletionItemKind.Module;
        default: return CompletionItemKind.Variable;
    }
}

/**
 * Where the cursor is, for deciding what to offer.
 */
function cursorContext(analysis: Analysis, offset: number): 'comment' | 'string' | 'import' | 'code' {
    const { tree } = analysis;
    const node = tree.getNodeAtPosition(Math.max(0, offset - 1));
    const token = isRedToken(node) ? node : tree.getTokenAtPosition(Math.max(0, offset - 1));

    // Leading trivia of the token at the cursor (comments live there)
    for (const candidate of [tree.getTokenAtPosition(offset), token]) {
        if (!candidate) continue;
        let position = candidate.position;
        for (const trivia of candidate.getLeadingTrivia()) {
            const end = position + trivia.width;
            if (position < offset && offset <= end &&
                (trivia.kind === SyntaxKind.SingleLineCommentTrivia || trivia.kind === SyntaxKind.MultiLineCommentTrivia)) {
                return 'comment';
            }
            position = end;
        }
    }

    if (token && token.kind === SyntaxKind.StringLiteral && token.span.start < offset) {
        if (token.parent?.kind === SyntaxKind.ImportStatement) {
            return 'import';
        }
        // Inside string text (template expressions inside strings are code)
        return 'string';
    }
    if (token?.parent?.kind === SyntaxKind.ImportStatement && token.kind !== SyntaxKind.ImportKeyword) {
        return 'import';
    }
    return 'code';
}

/** The argument the cursor is in: which command and parameter it's for */
interface ArgumentContext {
    command: Symbol;
    parameter: string;
    domain?: Domain;
}

function argumentContext(analysis: Analysis, offset: number): ArgumentContext | undefined {
    const found = findCall(analysis, offset);
    const command = found && analysis.binding.references.get(found.call.getChildren()[0]);
    if (!found || !command || command.kind !== SymbolKind.Command) {
        return undefined;
    }
    const index = found.argumentList.getChildren()
        .filter(c => c.kind === SyntaxKind.CommaToken && c.span.start < offset).length;
    const parameter = getParameterNames(command)[index];
    return parameter === undefined ? undefined : { command, parameter, domain: domainOfParameter(parameter) };
}

/** Parameters that take a label (a text pointer or jump target) */
const POINTER_PARAMETER = /^(target|label|ptr|pointer|address|addr|loc|location|text|jump|routine)$/i;

/**
 * How well a symbol fits an argument: 0 if its name matches the parameter, 1 if its kind
 * suits it (labels for pointers, constants and parameters otherwise), 2 otherwise.
 */
function argumentFit(symbol: Symbol, argument: ArgumentContext): number {
    const name = symbol.name.toLowerCase();
    const parameter = argument.parameter.toLowerCase();
    if (symbol.kind !== SymbolKind.Command && (name === parameter || (parameter.length > 2 && name.includes(parameter)))) {
        return 0;
    }
    if (POINTER_PARAMETER.test(argument.parameter)) {
        return symbol.kind === SymbolKind.Label ? 1 : 2;
    }
    return symbol.kind === SymbolKind.Constant || symbol.kind === SymbolKind.Parameter ? 1 : 2;
}

/** Keywords that can start an expression (the rest only make sense as statements) */
const EXPRESSION_KEYWORDS = new Set(['if', 'menu', 'flag', 'not', 'byte', 'short', 'long', 'count', 'setcount', 'insertbin']);

/**
 * Whether a '(' already follows the word at the cursor, so a call snippet would double it.
 */
function parenthesisFollows(analysis: Analysis, offset: number): boolean {
    const rest = analysis.tree.source.slice(offset, offset + 200);
    return /^[A-Za-z0-9_]*\s*\(/.test(rest);
}

function symbolItem(
    symbol: Symbol,
    analysis: Analysis,
    workspace: Workspace,
    options: CompletionOptions,
    sortText: string,
    insertCall = true
): CompletionItem {
    const declaringModule = symbol.modulePath ? workspace.program.getModule(symbol.modulePath) : undefined;
    const source = declaringModule?.tree.source;
    const docs = getDocComment(symbol, source);
    const fromElsewhere = symbol.modulePath && symbol.modulePath !== analysis.filePath && declaringModule
        ? `*${declaringModule.name}.ccs*`
        : undefined;

    const item: CompletionItem = {
        label: symbol.name,
        kind: completionKind(symbol.kind),
        detail: describeSymbol(symbol, source),
        sortText,
        documentation: docs || fromElsewhere ? {
            kind: MarkupKind.Markdown,
            value: [docs, fromElsewhere].filter(Boolean).join('\n\n'),
        } : undefined,
    };

    const parameters = symbol.kind === SymbolKind.Command ? getParameterNames(symbol) : [];
    if (parameters.length > 0 && options.snippetSupport && insertCall) {
        item.insertText = `${symbol.name}(${parameters.map((p, i) => `\${${i + 1}:${p}}`).join(', ')})`;
        item.insertTextFormat = InsertTextFormat.Snippet;
    }
    return item;
}

export async function provideCompletion(
    workspace: Workspace,
    analysis: Analysis,
    params: CompletionParams,
    options: CompletionOptions
): Promise<CompletionItem[]> {
    const { document, tree, binding, filePath } = analysis;
    const offset = document.offsetAt(params.position);
    const context = cursorContext(analysis, offset);
    const program = workspace.program;
    const fs = workspace.fileSystem;

    if (context === 'comment' || context === 'string') {
        return [];
    }

    if (context === 'import') {
        // Other .ccs files in this directory, and loaded modules relative to it
        const dir = fs.dirname(filePath);
        const paths = new Set<string>();
        for (const file of await fs.readDirectory(dir)) {
            if (file.toLowerCase().endsWith('.ccs') && fs.normalize(file) !== filePath) {
                paths.add(fs.basename(file));
            }
        }
        for (const module of program.getAllModules()) {
            if (module.filePath !== filePath && !workspace.isStandardLibrary(module.filePath)) {
                paths.add(fs.relative(dir, module.filePath).replace(/\\/g, '/'));
            }
        }
        return [...paths].sort().map(path => ({
            label: path,
            kind: CompletionItemKind.File,
            sortText: `${path.split('/').length}${path}`,
        }));
    }

    // An argument that refers to game data (an item, character...): offer the project's entries,
    // by name, inserting their number
    const argument = argumentContext(analysis, offset);
    const dataItems = argument ? await gameDataCompletions(workspace, analysis, argument) : [];
    const triggeredByPunctuation = params.context?.triggerKind === CompletionTriggerKind.TriggerCharacter &&
        (params.context.triggerCharacter === '(' || params.context.triggerCharacter === ',');
    if (triggeredByPunctuation) {
        return dataItems;
    }

    const insertCall = !parenthesisFollows(analysis, offset);

    // `module.member`
    const linePrefix = document.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
    const qualified = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
    if (qualified) {
        const target = program.getModuleByName(qualified[1]);
        if (!target) {
            return [];
        }
        return program.getModuleDeclarations(target).getAllSymbols()
            .filter(s => s.scopeId === 0 && s.kind !== SymbolKind.Module)
            .map(s => symbolItem(s, analysis, workspace, options, `0${s.name}`, insertCall));
    }

    // Symbols visible at the cursor
    const node = tree.getNodeAtPosition(Math.max(0, offset - 1));
    let scopeId: number | undefined;
    for (let current: typeof node | null = node; current && scopeId === undefined; current = current.parent) {
        scopeId = binding.nodeScopes.get(current.position);
    }
    const scope = binding.scopes.getScope(scopeId ?? 0) ?? binding.scopes.getGlobalScope();
    const visibleScopes = binding.scopes.getVisibleScopes(scope);

    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const symbol of binding.symbols.getVisibleSymbols(visibleScopes).reverse()) {
        if (symbol.kind === SymbolKind.Module || seen.has(symbol.name)) {
            continue; // Modules are offered below; inner/own declarations shadow outer ones
        }
        seen.add(symbol.name);
        // Locals, then this file's declarations, then imported ones
        const group = symbol.scopeId !== 0 ? 0 : symbol.modulePath === filePath ? 1 : 2;
        if (!argument) {
            items.push(symbolItem(symbol, analysis, workspace, options, `${group}${symbol.name}`, insertCall));
            continue;
        }

        // In an argument: what fits the parameter first (game data sorts between 'a' and 'c')
        const fit = argumentFit(symbol, argument);
        const item = symbolItem(symbol, analysis, workspace, options, `${'acd'[fit]}${group}${symbol.name}`, insertCall);
        if (fit < 2) {
            item.labelDetails = { description: `for ${argument.parameter}` };
        }
        if (fit === 0) {
            item.preselect = true;
        }
        items.push(item);
    }

    for (const module of program.getAllModules()) {
        if (module.filePath === filePath || seen.has(module.name)) {
            continue;
        }
        seen.add(module.name);
        items.push({
            label: module.name,
            kind: CompletionItemKind.Module,
            detail: fs.relative(fs.dirname(filePath), module.filePath).replace(/\\/g, '/'),
            sortText: `${argument ? 'e' : '3'}${module.name}`,
        });
    }

    for (const keyword of KEYWORDS) {
        if (argument && !EXPRESSION_KEYWORDS.has(keyword)) continue;
        items.push({ label: keyword, kind: CompletionItemKind.Keyword, sortText: `${argument ? 'f' : '4'}${keyword}` });
    }

    return [...dataItems, ...items];
}

async function gameDataCompletions(workspace: Workspace, analysis: Analysis, argument: ArgumentContext): Promise<CompletionItem[]> {
    const domain = argument.domain;
    const project = domain ? await workspace.projectFor(analysis.filePath) : undefined;
    if (!domain || !project) {
        return [];
    }

    const title = DOMAIN_TITLES[domain];
    return (await project.entries(domain, labelTextResolver(workspace)))
        .filter(entry => entry.name)
        .map(entry => ({
            label: entry.name!,
            kind: CompletionItemKind.EnumMember,
            detail: `${title} ${entry.id}`,
            insertText: String(entry.id),
            filterText: `${entry.name} ${entry.id}`,
            sortText: `b${String(entry.id).padStart(6, '0')}`,
            labelDetails: { description: `for ${argument.parameter}` },
        }));
}
