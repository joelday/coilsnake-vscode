import { SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend } from 'vscode-languageserver/node';
import { Symbol, SymbolKind, SyntaxKind } from 'ccscript-core';
import { importInfo, referenceNameSpan } from '../symbols';
import { Analysis, Workspace } from '../workspace';

const TOKEN_TYPES = ['keyword', 'type', 'function', 'variable', 'parameter', 'label', 'namespace', 'number'] as const;
const TOKEN_MODIFIERS = ['declaration', 'readonly', 'defaultLibrary'] as const;

export const semanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
};

const type = (name: typeof TOKEN_TYPES[number]) => TOKEN_TYPES.indexOf(name);
const modifier = (name: typeof TOKEN_MODIFIERS[number]) => 1 << TOKEN_MODIFIERS.indexOf(name);

function symbolType(symbol: Symbol): number {
    switch (symbol.kind) {
        case SymbolKind.Command: return type('function');
        case SymbolKind.Label: return type('label');
        case SymbolKind.Parameter: return type('parameter');
        case SymbolKind.Module: return type('namespace');
        default: return type('variable');
    }
}

export function provideSemanticTokens(workspace: Workspace, analysis: Analysis): SemanticTokens {
    const { binding, document, filePath, tree } = analysis;

    // Identifier positions -> what they name
    const declarations = new Map<number, Symbol>();
    for (const symbol of binding.symbols.getAllSymbols()) {
        if (symbol.modulePath === filePath) {
            declarations.set(symbol.position, symbol);
        }
    }
    const references = new Map<number, Symbol>();
    const modules = new Set<number>();
    for (const [node, symbol] of binding.references) {
        references.set(referenceNameSpan(node).start, symbol);
        if (node.kind === SyntaxKind.QualifiedNameExpression) {
            modules.add(node.getChildren()[0].span.start);
        }
    }
    for (const statement of tree.getStatements()) {
        if (statement.kind === SyntaxKind.ImportStatement) {
            const info = importInfo(statement);
            if (info?.token.kind === SyntaxKind.Identifier) {
                modules.add(info.token.span.start);
            }
        }
    }

    const builder = new SemanticTokensBuilder();
    for (const token of tree.getTokens()) {
        const start = token.span.start;
        let tokenType: number | undefined;
        let modifiers = 0;

        if (SyntaxKind.isKeyword(token.kind)) {
            tokenType = token.kind === SyntaxKind.ByteKeyword || token.kind === SyntaxKind.ShortKeyword ||
                token.kind === SyntaxKind.LongKeyword ? type('type') : type('keyword');
        } else if (token.kind === SyntaxKind.NumericLiteral || token.kind === SyntaxKind.HexLiteral) {
            tokenType = type('number');
        } else if (token.kind === SyntaxKind.Identifier) {
            const declared = declarations.get(start);
            const symbol = declared ?? references.get(start);
            if (symbol) {
                tokenType = symbolType(symbol);
                if (declared) modifiers |= modifier('declaration');
                if (symbol.kind === SymbolKind.Constant) modifiers |= modifier('readonly');
                if (symbol.modulePath && workspace.isStandardLibrary(symbol.modulePath)) {
                    modifiers |= modifier('defaultLibrary');
                }
            } else if (modules.has(start)) {
                tokenType = type('namespace');
            }
        }

        if (tokenType !== undefined && token.text.length > 0) {
            const position = document.positionAt(start);
            builder.push(position.line, position.character, token.text.length, tokenType, modifiers);
        }
    }
    return builder.build();
}
