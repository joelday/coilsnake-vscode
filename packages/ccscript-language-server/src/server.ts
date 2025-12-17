#!/usr/bin/env node
/**
 * CCScript Language Server
 * 
 * LSP-compliant language server for CCScript that can be used
 * by any editor supporting the Language Server Protocol.
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    Hover,
    MarkupKind,
    Location,
    SemanticTokensBuilder,
    Diagnostic,
    DiagnosticSeverity as LspDiagnosticSeverity,
    DocumentSymbol,
    SymbolKind as LspSymbolKind,
    Range,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SyntaxTree, SymbolKind, DiagnosticSeverity, SyntaxKind, RedToken, RedNode } from 'ccscript-core';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for parsed syntax trees
const syntaxTrees = new Map<string, SyntaxTree>();

connection.onInitialize((_params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.']
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            documentSymbolProvider: true,
            renameProvider: true,
            semanticTokensProvider: {
                legend: {
                    tokenTypes: [
                        'keyword',
                        'type',
                        'variable',
                        'function',
                        'number',
                        'string',
                        'comment',
                        'operator',
                        'label',
                    ],
                    tokenModifiers: ['declaration', 'readonly']
                },
                full: true
            }
        }
    };

    return result;
});

// Parse and cache document
function parseDocument(document: TextDocument): SyntaxTree {
    const text = document.getText();
    const tree = SyntaxTree.parse(text);
    syntaxTrees.set(document.uri, tree);
    return tree;
}

// Get or parse document
function getOrParseDocument(document: TextDocument): SyntaxTree {
    const cached = syntaxTrees.get(document.uri);
    if (cached && cached.source === document.getText()) {
        return cached;
    }
    return parseDocument(document);
}

// Validate document and send diagnostics
function validateDocument(document: TextDocument): void {
    const tree = getOrParseDocument(document);
    const allDiagnostics = tree.getAllDiagnostics();

    connection.console.log(`Validating: ${allDiagnostics.length} diagnostics found`);

    const diagnostics: Diagnostic[] = allDiagnostics.map((diag, idx: number) => {
        // Type guard: SemanticDiagnostic has 'position', Diagnostic has 'span'
        const isSemanticDiag = 'position' in diag;

        const severity = isSemanticDiag
            ? (diag.severity === 'error' ? LspDiagnosticSeverity.Error :
                diag.severity === 'warning' ? LspDiagnosticSeverity.Warning :
                    LspDiagnosticSeverity.Information)
            : (diag.severity === DiagnosticSeverity.Error ? LspDiagnosticSeverity.Error :
                diag.severity === DiagnosticSeverity.Warning ? LspDiagnosticSeverity.Warning :
                    LspDiagnosticSeverity.Information);

        const offset = isSemanticDiag ? diag.position : diag.span.start;
        const length = isSemanticDiag ? diag.length : diag.span.length;

        // Debug: compare our position calculation vs TextDocument's
        const ourPos = tree.getLineAndColumn(offset);
        const theirPos = document.positionAt(offset);

        connection.console.log(
            `[${idx}] offset=${offset} length=${length} ` +
            `ours=(${ourPos.line},${ourPos.column}) ` +
            `theirs=(${theirPos.line},${theirPos.character}) ` +
            `char="${document.getText().substring(offset, offset + 1)}" ` +
            `msg="${diag.message}"`
        );

        const start = document.positionAt(offset);
        const end = document.positionAt(offset + length);

        return {
            severity,
            range: { start, end },
            message: diag.message,
            source: 'ccscript'
        };
    });

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// Document change handling
documents.onDidChangeContent((change) => {
    validateDocument(change.document);
});

documents.onDidClose((e) => {
    syntaxTrees.delete(e.document.uri);
});

// Completion provider
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = getOrParseDocument(document);
    const symbols = tree.getSymbolTable();
    const allSymbols = symbols.getAllSymbols();

    const completions: CompletionItem[] = [];

    // Add all visible symbols
    for (const symbol of allSymbols) {
        const kind = symbol.kind === SymbolKind.Command ? CompletionItemKind.Function :
            symbol.kind === SymbolKind.Constant ? CompletionItemKind.Constant :
                symbol.kind === SymbolKind.Variable ? CompletionItemKind.Variable :
                    symbol.kind === SymbolKind.Label ? CompletionItemKind.Reference :
                        CompletionItemKind.Variable;

        completions.push({
            label: symbol.name,
            kind,
            detail: symbol.type.name,
            documentation: `${symbol.kind} at line ${tree.getLineAndColumn(symbol.position).line + 1}`
        });
    }

    // Add keywords
    const keywords = [
        'command', 'define', 'if', 'else', 'flag', 'not', 'and', 'or',
        'byte', 'short', 'long', 'menu', 'default', 'ROM', 'ROMTBL'
    ];

    for (const keyword of keywords) {
        completions.push({
            label: keyword,
            kind: CompletionItemKind.Keyword
        });
    }

    return completions;
});

// Hover provider
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const node = tree.getNodeAtPosition(offset);

    if (!node) {
        return null;
    }

    // Check if we're on a symbol
    const symbol = tree.getSymbolAt(offset);
    if (symbol) {
        const content = [
            `**${symbol.name}** (${symbol.kind})`,
            '',
            `Type: \`${symbol.type.name}\``,
            '',
            `Declared at line ${tree.getLineAndColumn(symbol.position).line + 1}`
        ];

        if (symbol.parameters && symbol.parameters.length > 0) {
            content.push('', 'Parameters:');
            for (const param of symbol.parameters) {
                content.push(`- ${param.name}`);
            }
        }

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content.join('\n')
            }
        };
    }

    // Check if we're on an identifier reference
    const refSymbol = tree.getReferencedSymbol(node);
    if (refSymbol) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${refSymbol.name}** (${refSymbol.kind})\n\nType: \`${refSymbol.type.name}\``
            }
        };
    }

    // Show type information
    const type = tree.getTypeOf(node);
    if (type) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `Type: \`${type.name}\``
            }
        };
    }

    return null;
});

// Definition provider
connection.onDefinition((params: TextDocumentPositionParams): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const node = tree.getNodeAtPosition(offset);

    if (!node) {
        return null;
    }

    const refSymbol = tree.getReferencedSymbol(node);
    if (refSymbol) {
        const pos = document.positionAt(refSymbol.position);
        return {
            uri: params.textDocument.uri,
            range: {
                start: pos,
                end: document.positionAt(refSymbol.position + refSymbol.name.length)
            }
        };
    }

    return null;
});

// References provider
connection.onReferences((params): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const symbol = tree.getSymbolAt(offset);

    if (!symbol) {
        return [];
    }

    const references = tree.findReferences(symbol);
    const locations: Location[] = [];

    // Add declaration if requested
    if (params.context && params.context.includeDeclaration) {
        const declPos = document.positionAt(symbol.position);
        locations.push({
            uri: params.textDocument.uri,
            range: {
                start: declPos,
                end: document.positionAt(symbol.position + symbol.name.length)
            }
        });
    }

    // Add all references
    for (const ref of references) {
        const start = document.positionAt(ref.position);
        const end = document.positionAt(ref.position + ref.width);
        locations.push({
            uri: params.textDocument.uri,
            range: { start, end }
        });
    }

    return locations;
});

// Document symbols provider
connection.onDocumentSymbol((params): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = getOrParseDocument(document);
    const symbols: DocumentSymbol[] = [];

    // Helper to find identifier token in a declaration node
    const findIdentifier = (node: RedNode): RedToken | null => {
        const children = node.getChildren();
        for (const child of children) {
            if (child instanceof RedToken && child.kind === SyntaxKind.Identifier) {
                return child;
            }
        }
        return null;
    };

    // Get constants
    const constants = tree.getConstants();
    for (const constant of constants) {
        const identifier = findIdentifier(constant);
        if (identifier) {
            const leadingTriviaWidth = identifier.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
            const tokenPosition = identifier.position + leadingTriviaWidth;
            const startPos = document.positionAt(tokenPosition);
            const endPos = document.positionAt(tokenPosition + identifier.text.length);
            symbols.push(DocumentSymbol.create(
                identifier.text,
                '',
                LspSymbolKind.Constant,
                Range.create(document.positionAt(constant.position), document.positionAt(constant.end)),
                Range.create(startPos, endPos)
            ));
        }
    }

    // Get commands
    const commands = tree.getCommands();
    for (const command of commands) {
        const identifier = findIdentifier(command);
        if (identifier) {
            const leadingTriviaWidth = identifier.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
            const tokenPosition = identifier.position + leadingTriviaWidth;
            const startPos = document.positionAt(tokenPosition);
            const endPos = document.positionAt(tokenPosition + identifier.text.length);
            symbols.push(DocumentSymbol.create(
                identifier.text,
                '',
                LspSymbolKind.Function,
                Range.create(document.positionAt(command.position), document.positionAt(command.end)),
                Range.create(startPos, endPos)
            ));
        }
    }

    // Get labels
    const labels = tree.getLabels();
    for (const label of labels) {
        const identifier = findIdentifier(label);
        if (identifier) {
            const leadingTriviaWidth = identifier.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
            const tokenPosition = identifier.position + leadingTriviaWidth;
            const startPos = document.positionAt(tokenPosition);
            const endPos = document.positionAt(tokenPosition + identifier.text.length);
            symbols.push(DocumentSymbol.create(
                identifier.text,
                '',
                LspSymbolKind.String, // Closest to label
                Range.create(document.positionAt(label.position), document.positionAt(label.end)),
                Range.create(startPos, endPos)
            ));
        }
    }

    return symbols;
});

// Semantic tokens provider
connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return { data: [] };
    }

    const tree = getOrParseDocument(document);
    const tokens: number[] = [];

    // Get all tokens from the tree
    const allNodes = tree.getRoot().getDescendants();
    const redTokens = allNodes.filter(n => n instanceof RedToken) as RedToken[];

    let prevLine = 0;
    let prevChar = 0;

    for (const token of redTokens) {
        // Skip trivia tokens (we only want actual code tokens)
        if (token.kind >= SyntaxKind.WhitespaceTrivia && token.kind <= SyntaxKind.MultiLineCommentTrivia) {
            continue;
        }

        // Calculate position after leading trivia
        const leadingTriviaWidth = token.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
        const tokenPosition = token.position + leadingTriviaWidth;
        const pos = document.positionAt(tokenPosition);

        // Determine token type
        let tokenType = 0; // default to keyword
        const tokenModifiers = 0;

        if (token.kind >= SyntaxKind.AndKeyword && token.kind <= SyntaxKind.TrueKeyword) {
            tokenType = 0; // keyword
        } else if (token.kind === SyntaxKind.Identifier) {
            tokenType = 2; // variable (default for identifiers)
        } else if (token.kind === SyntaxKind.NumericLiteral || token.kind === SyntaxKind.HexLiteral) {
            tokenType = 4; // number
        } else if (token.kind === SyntaxKind.StringLiteral) {
            tokenType = 5; // string
        } else if (token.kind === SyntaxKind.SingleLineCommentTrivia || token.kind === SyntaxKind.MultiLineCommentTrivia) {
            tokenType = 6; // comment
        } else if (token.kind === SyntaxKind.ByteKeyword || token.kind === SyntaxKind.ShortKeyword ||
            token.kind === SyntaxKind.LongKeyword) {
            tokenType = 1; // type
        }

        // Encode as delta from previous token
        const deltaLine = pos.line - prevLine;
        const deltaChar = deltaLine === 0 ? pos.character - prevChar : pos.character;

        tokens.push(
            deltaLine,
            deltaChar,
            token.text.length,
            tokenType,
            tokenModifiers
        );

        prevLine = pos.line;
        prevChar = pos.character;
    }

    return { data: tokens };
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

console.error('CCScript Language Server started');
