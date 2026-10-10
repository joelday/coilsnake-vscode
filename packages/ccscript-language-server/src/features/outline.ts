import {
    DocumentSymbol,
    SymbolInformation,
    SymbolKind as LspSymbolKind,
    WorkspaceSymbolParams,
} from 'vscode-languageserver/node';
import { Module, Symbol, SymbolKind } from 'ccscript-core';
import { describeSymbol, toRange } from '../symbols';
import { Analysis, Workspace } from '../workspace';

function lspKind(kind: SymbolKind): LspSymbolKind | undefined {
    switch (kind) {
        case SymbolKind.Command: return LspSymbolKind.Function;
        case SymbolKind.Constant: return LspSymbolKind.Constant;
        case SymbolKind.Label: return LspSymbolKind.Key;
        default: return undefined;
    }
}

export function provideDocumentSymbols(workspace: Workspace, analysis: Analysis): DocumentSymbol[] {
    const { binding, filePath, module, tree } = analysis;
    const own = binding.symbols.getAllSymbols()
        .filter(s => s.modulePath === filePath && lspKind(s.kind) !== undefined)
        .sort((a, b) => a.position - b.position);

    const toDocumentSymbol = (symbol: Symbol): DocumentSymbol => {
        const range = toRange(workspace, module, symbol.declaration.span);
        const selectionRange = toRange(workspace, module, { start: symbol.position, length: symbol.length });
        const detail = symbol.kind === SymbolKind.Label ? undefined : describeSymbol(symbol, tree.source)
            .replace(/^(command|define) /, '');
        return DocumentSymbol.create(symbol.name, detail, lspKind(symbol.kind)!, range, selectionRange, []);
    };

    // Top-level declarations, with labels inside commands nested under them
    const topLevel = own.filter(s => s.scopeId === 0).map(s => ({ symbol: s, documentSymbol: toDocumentSymbol(s) }));
    for (const nested of own.filter(s => s.scopeId !== 0)) {
        const parent = topLevel.find(({ symbol }) => symbol.kind === SymbolKind.Command &&
            symbol.declaration.span.start <= nested.position &&
            nested.position < symbol.declaration.span.start + symbol.declaration.span.length);
        if (parent) {
            parent.documentSymbol.children!.push(toDocumentSymbol(nested));
        }
    }
    return topLevel.map(t => t.documentSymbol);
}

/**
 * Whether the query's characters appear in order in the name (case-insensitively).
 */
function fuzzyMatch(query: string, name: string): boolean {
    let index = 0;
    const lowerName = name.toLowerCase();
    for (const ch of query.toLowerCase()) {
        index = lowerName.indexOf(ch, index);
        if (index < 0) return false;
        index++;
    }
    return true;
}

const MAX_WORKSPACE_SYMBOLS = 500;

export function provideWorkspaceSymbols(workspace: Workspace, params: WorkspaceSymbolParams): SymbolInformation[] {
    const program = workspace.program;
    const query = params.query.toLowerCase();
    const matches: { symbol: Symbol; module: Module; kind: LspSymbolKind; prefix: boolean }[] = [];

    for (const module of program.getAllModules()) {
        for (const symbol of program.getModuleDeclarations(module).getAllSymbols()) {
            const kind = lspKind(symbol.kind);
            if (kind !== undefined && symbol.scopeId === 0 && fuzzyMatch(query, symbol.name)) {
                matches.push({ symbol, module, kind, prefix: symbol.name.toLowerCase().startsWith(query) });
            }
        }
    }

    // Prefix matches first, then shorter names
    matches.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.symbol.name.length - b.symbol.name.length);
    return matches.slice(0, MAX_WORKSPACE_SYMBOLS).map(({ symbol, module, kind }) => SymbolInformation.create(
        symbol.name,
        kind,
        toRange(workspace, module, { start: symbol.position, length: symbol.length }),
        workspace.uriFor(module),
        module.name
    ));
}
