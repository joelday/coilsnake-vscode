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
    TextEdit,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    SyntaxTree,
    SymbolKind,
    DiagnosticSeverity,
    SyntaxKind,
    RedNode,
    Program,
    NodeFileSystem,
    AggregatedFileSystem
} from 'ccscript-core';
import { DocumentFileSystem } from './documentFileSystem';
import { URI } from 'vscode-uri';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Create aggregated file system (documents override disk files)
const documentFS = new DocumentFileSystem(documents);
const diskFS = new NodeFileSystem();
const fileSystem = new AggregatedFileSystem(documentFS, diskFS);

// Create program for multi-file compilation
let program: Program | null = null;
let workspaceRoot: string | null = null;

// Cache for parsed syntax trees
const syntaxTrees = new Map<string, SyntaxTree>();

// Configuration
interface CCScriptSettings {
    stdLibPath?: string;
}

const settings: CCScriptSettings = {};

connection.onInitialize((params: InitializeParams) => {
    // Initialize workspace root and program
    if (params.rootUri) {
        workspaceRoot = URI.parse(params.rootUri).fsPath;

        // Get initial configuration if provided
        const config = params.initializationOptions as CCScriptSettings | undefined;
        if (config?.stdLibPath) {
            settings.stdLibPath = config.stdLibPath;
            connection.console.log(`[CCScript:LSP] Standard library path: ${settings.stdLibPath}`);
        }

        program = new Program({
            fileSystem,
            rootPath: workspaceRoot,
            includeStdLibs: !!settings.stdLibPath,
            stdLibPaths: settings.stdLibPath ? {
                std: fileSystem.join(settings.stdLibPath, 'std.ccs'),
                stdarg: fileSystem.join(settings.stdLibPath, 'stdarg.ccs')
            } : undefined
        });
        connection.console.log(`[CCScript:LSP] Initialized with workspace: ${workspaceRoot}`);
    } else {
        connection.console.warn('[CCScript:LSP] No workspace root provided');
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.']
            },
            hoverProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ',']
            },
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

/**
 * Convert document URI to file path
 */
function uriToPath(uri: string): string {
    return URI.parse(uri).fsPath;
}

// Parse and cache document using Program
async function parseDocument(document: TextDocument): Promise<SyntaxTree> {
    if (!program) {
        // Fallback to standalone parse if no workspace
        connection.console.warn('[CCScript:LSP] Parsing without Program (no workspace)');
        const tree = SyntaxTree.parse(document.getText());
        syntaxTrees.set(document.uri, tree);
        return tree;
    }

    const filePath = uriToPath(document.uri);
    connection.console.log(`[CCScript:LSP] Loading module: ${filePath}`);

    const module = await program.loadModule(filePath);
    if (!module) {
        connection.console.error(`[CCScript:LSP] Failed to load module: ${filePath}`);
        // Fallback to standalone parse
        const tree = SyntaxTree.parse(document.getText());
        syntaxTrees.set(document.uri, tree);
        return tree;
    }

    syntaxTrees.set(document.uri, module.tree);
    return module.tree;
}

// Get or parse document
async function getOrParseDocument(document: TextDocument): Promise<SyntaxTree> {
    const cached = syntaxTrees.get(document.uri);
    if (cached && cached.source === document.getText()) {
        return cached;
    }
    return await parseDocument(document);
}

// Validate document and send diagnostics
async function validateDocument(document: TextDocument): Promise<void> {
    const tree = await getOrParseDocument(document);
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
    if (program) {
        const filePath = uriToPath(change.document.uri);
        // Reload the module to invalidate siblings
        program.reloadModule(filePath).then(() => {
            validateDocument(change.document);
        }).catch((err: unknown) => {
            connection.console.error(`[CCScript:LSP] Error reloading module: ${err}`);
            validateDocument(change.document);
        });
    } else {
        validateDocument(change.document);
    }
});

documents.onDidClose((e) => {
    syntaxTrees.delete(e.document.uri);
});

// Completion provider
connection.onCompletion(async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);

    // Get only symbols visible at the cursor position (scope-aware, includes imports)
    const visibleSymbols = tree.getVisibleSymbolsAt(offset);

    const completions: CompletionItem[] = [];

    // Add only visible symbols
    for (const symbol of visibleSymbols) {
        const kind = symbol.kind === SymbolKind.Command ? CompletionItemKind.Function :
            symbol.kind === SymbolKind.Constant ? CompletionItemKind.Constant :
                symbol.kind === SymbolKind.Variable ? CompletionItemKind.Variable :
                    symbol.kind === SymbolKind.Label ? CompletionItemKind.Reference :
                        symbol.kind === SymbolKind.Module ? CompletionItemKind.Module :
                            CompletionItemKind.Variable;

        // Build detail string
        let detail = symbol.type.name;
        if (symbol.kind === SymbolKind.Command && symbol.parameters && symbol.parameters.length > 0) {
            const paramStr = symbol.parameters.map(p => `${p.name}`).join(', ');
            detail = `(${paramStr}) → ${symbol.type.name}`;
        }

        // Build documentation
        const docs: string[] = [];
        if (symbol.kind === SymbolKind.Command && symbol.parameters && symbol.parameters.length > 0) {
            docs.push('**Parameters:**');
            for (const param of symbol.parameters) {
                docs.push(`- \`${param.name}\``);
            }
        }
        if (symbol.modulePath) {
            docs.push(`\n*From:* \`${symbol.modulePath}\``);
        }

        completions.push({
            label: symbol.name,
            kind,
            detail,
            documentation: docs.length > 0 ? {
                kind: MarkupKind.Markdown,
                value: docs.join('\n')
            } : undefined
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
connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const node = tree.getNodeAtPosition(offset);

    if (!node) {
        return null;
    }

    // Check if we're on a symbol declaration (pass filePath to filter imported symbols)
    const filePath = uriToPath(document.uri);
    const symbol = tree.getSymbolAt(offset, filePath);
    if (symbol) {
        const content: string[] = [];

        // Title with kind badge
        const kindName = symbol.kind === SymbolKind.Command ? 'command' :
            symbol.kind === SymbolKind.Constant ? 'constant' :
                symbol.kind === SymbolKind.Variable ? 'variable' :
                    symbol.kind === SymbolKind.Label ? 'label' : 'symbol';

        // Build signature for commands
        if (symbol.kind === SymbolKind.Command && symbol.parameters && symbol.parameters.length > 0) {
            const paramStr = symbol.parameters.map(p => `${p.name}`).join(', ');
            content.push(`\`\`\`ccscript\ncommand ${symbol.name}(${paramStr})\n\`\`\``);
        } else {
            content.push(`**${symbol.name}**`);
        }

        content.push('', `*${kindName}* • Type: \`${symbol.type.name}\``);

        // Parameters section for commands
        if (symbol.parameters && symbol.parameters.length > 0) {
            content.push('', '---', '', '**Parameters:**', '');
            for (const param of symbol.parameters) {
                content.push(`- \`${param.name}\``);
            }
        }

        // Location info
        content.push('', '---', '', `📍 Line ${tree.getLineAndColumn(symbol.position).line + 1}`);

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content.join('\n')
            }
        };
    }

    // Walk up the tree to find an expression node that might have a reference
    let currentNode: RedNode | null = node;
    while (currentNode) {
        // Check if this node has a symbol reference
        const refSymbol = tree.getReferencedSymbol(currentNode);
        if (refSymbol) {
            const content: string[] = [];

            // Title with kind badge
            const kindName = refSymbol.kind === SymbolKind.Command ? 'command' :
                refSymbol.kind === SymbolKind.Constant ? 'constant' :
                    refSymbol.kind === SymbolKind.Variable ? 'variable' :
                        refSymbol.kind === SymbolKind.Label ? 'label' : 'symbol';

            // Build signature for commands
            if (refSymbol.kind === SymbolKind.Command && refSymbol.parameters && refSymbol.parameters.length > 0) {
                const paramStr = refSymbol.parameters.map(p => `${p.name}`).join(', ');
                content.push(`\`\`\`ccscript\ncommand ${refSymbol.name}(${paramStr})\n\`\`\``);
            } else {
                content.push(`**${refSymbol.name}**`);
            }

            content.push('', `*${kindName}* • Type: \`${refSymbol.type.name}\``);

            // Module info if imported
            if (refSymbol.modulePath) {
                content.push('', `📦 Imported from \`${refSymbol.modulePath}\``);
            }

            // Parameters section for commands
            if (refSymbol.parameters && refSymbol.parameters.length > 0) {
                content.push('', '---', '', '**Parameters:**', '');
                for (const param of refSymbol.parameters) {
                    content.push(`- \`${param.name}\``);
                }
            }

            // Location info
            content.push('', '---', '', `📍 Line ${tree.getLineAndColumn(refSymbol.position).line + 1}`);

            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: content.join('\n')
                }
            };
        }

        // Move up to parent
        currentNode = currentNode.parent;
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

// Signature help provider
connection.onSignatureHelp(async (params: TextDocumentPositionParams): Promise<SignatureHelp | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);

    // Find the closest call expression by walking up from cursor position
    let node = tree.getNodeAtPosition(offset);
    if (!node) {
        return null;
    }

    // Walk up to find a CallExpression
    let callNode: RedNode | null = null;
    let currentNode: RedNode | null = node;
    while (currentNode) {
        if (currentNode.kind === SyntaxKind.CallExpression) {
            callNode = currentNode;
            break;
        }
        currentNode = currentNode.parent;
    }

    if (!callNode) {
        return null;
    }

    // Get the function being called (first child should be the identifier)
    const children = callNode.getChildren();
    const identifierNode = children.find(c => c.kind === SyntaxKind.Identifier);
    if (!identifierNode) {
        return null;
    }

    // Look up the symbol for this identifier
    const symbol = tree.getReferencedSymbol(identifierNode);
    if (!symbol || symbol.kind !== SymbolKind.Command || !symbol.parameters) {
        return null;
    }

    // Build signature information
    const paramLabels: string[] = [];
    const paramInfos: ParameterInformation[] = [];
    
    for (const param of symbol.parameters) {
        const label = param.name;
        paramLabels.push(label);
        paramInfos.push({
            label,
            documentation: `Parameter: ${param.name}`
        });
    }

    const signature = `${symbol.name}(${paramLabels.join(', ')})`;

    // Determine which parameter we're currently on
    // Count commas before cursor position within the call expression
    let activeParameter = 0;
    const callStart = callNode.position;
    const callText = document.getText({
        start: document.positionAt(callStart),
        end: document.positionAt(callNode.end)
    });

    // Find opening paren position
    const openParenIndex = callText.indexOf('(');
    if (openParenIndex === -1) {
        activeParameter = 0;
    } else {
        const relativeOffset = offset - callStart;
        const textBeforeCursor = callText.substring(openParenIndex + 1, relativeOffset);
        
        // Count commas (simple approach - doesn't handle nested calls, but good enough for now)
        activeParameter = (textBeforeCursor.match(/,/g) || []).length;
    }

    // Clamp to valid parameter range
    if (activeParameter >= paramInfos.length) {
        activeParameter = paramInfos.length - 1;
    }

    return {
        signatures: [
            {
                label: signature,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `**${symbol.name}**\n\nCommand with ${symbol.parameters.length} parameter${symbol.parameters.length !== 1 ? 's' : ''}`
                },
                parameters: paramInfos
            }
        ],
        activeSignature: 0,
        activeParameter: Math.max(0, activeParameter)
    };
});

// Definition provider
connection.onDefinition(async (params: TextDocumentPositionParams): Promise<Location | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    let node: RedNode | null = tree.getNodeAtPosition(offset);

    if (!node) {
        return null;
    }

    // Walk up the tree to find a node with a symbol reference
    while (node) {
        const refSymbol = tree.getReferencedSymbol(node);
        if (refSymbol) {
            // Check if symbol is from another module
            let targetUri = params.textDocument.uri;
            let targetDocument = document;

            if (refSymbol.modulePath && program) {
                // Symbol is from an imported module - need to get that document
                const module = program.getModule(refSymbol.modulePath);
                if (module) {
                    targetUri = URI.file(module.filePath).toString();
                    const targetDoc = documents.get(targetUri);
                    if (targetDoc) {
                        targetDocument = targetDoc;
                    } else {
                        // Document not open, use file path
                        const pos = module.tree.getLineAndColumn(refSymbol.position);
                        return {
                            uri: targetUri,
                            range: {
                                start: { line: pos.line, character: pos.column },
                                end: { line: pos.line, character: pos.column + refSymbol.length }
                            }
                        };
                    }
                }
            }

            const start = targetDocument.positionAt(refSymbol.position);
            const end = targetDocument.positionAt(refSymbol.position + refSymbol.length);
            return {
                uri: targetUri,
                range: { start, end }
            };
        }

        node = node.parent;
    }

    return null;
});

// References provider
connection.onReferences(async (params): Promise<Location[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const filePath = uriToPath(document.uri);
    let node: RedNode | null = tree.getNodeAtPosition(offset);

    if (!node) {
        return [];
    }

    // Try to find a symbol - either declaration or reference
    let symbol = tree.getSymbolAt(offset, filePath);

    // If not a declaration, walk up to find a reference
    if (!symbol) {
        while (node) {
            symbol = tree.getReferencedSymbol(node);
            if (symbol) {
                break;
            }
            node = node.parent;
        }
    }

    if (!symbol) {
        return [];
    }

    const locations: Location[] = [];

    // Helper to add location from a tree
    const addLocationsFromTree = (targetTree: SyntaxTree, targetUri: string) => {
        const targetDoc = documents.get(targetUri);
        const targetFilePath = uriToPath(targetUri);
        const targetSymbolTable = targetTree.getSymbolTable();

        // Look up the symbol by its unique ID in this tree
        // Imported symbols preserve the original ID, so this works across files
        const targetSymbol = targetSymbolTable.getById(symbol!.id);

        if (!targetSymbol) {
            return; // Symbol not visible in this file
        }

        // Add declaration if requested and in this file
        if (params.context && params.context.includeDeclaration) {
            // Check if the declaration is in this file (not imported)
            if (!targetSymbol.modulePath || targetSymbol.modulePath === targetFilePath) {
                if (targetDoc) {
                    const start = targetDoc.positionAt(targetSymbol.position);
                    const end = targetDoc.positionAt(targetSymbol.position + targetSymbol.length);
                    locations.push({
                        uri: targetUri,
                        range: { start, end }
                    });
                } else {
                    const pos = targetTree.getLineAndColumn(targetSymbol.position);
                    locations.push({
                        uri: targetUri,
                        range: {
                            start: { line: pos.line, character: pos.column },
                            end: { line: pos.line, character: pos.column + targetSymbol.length }
                        }
                    });
                }
            }
        }

        // Add all references in this file to the target symbol
        const references = targetTree.findReferences(targetSymbol);
        for (const ref of references) {
            if (targetDoc) {
                const start = targetDoc.positionAt(ref.position);
                const end = targetDoc.positionAt(ref.position + ref.width);
                locations.push({
                    uri: targetUri,
                    range: { start, end }
                });
            } else {
                const pos = targetTree.getLineAndColumn(ref.position);
                locations.push({
                    uri: targetUri,
                    range: {
                        start: { line: pos.line, character: pos.column },
                        end: { line: pos.line, character: pos.column + ref.width }
                    }
                });
            }
        }
    };

    // Search in current file
    addLocationsFromTree(tree, params.textDocument.uri);

    // If we have a program, search in all modules for references
    if (program) {
        const allModules = program.getAllModules();

        for (const module of allModules) {
            if (module.filePath === filePath) {
                continue; // Already searched current file
            }

            // Search in all other modules for references to this symbol
            // The symbol might be imported/accessible via sibling imports
            const moduleUri = URI.file(module.filePath).toString();
            addLocationsFromTree(module.tree, moduleUri);
        }
    }

    return locations;
});

// Document symbols provider
connection.onDocumentSymbol(async (params): Promise<DocumentSymbol[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const tree = await getOrParseDocument(document);
    const filePath = uriToPath(document.uri);
    const symbolTable = tree.getSymbolTable();
    const documentSymbols: DocumentSymbol[] = [];

    // Get all symbols for this file (filter out imported symbols from other modules)
    const allSymbols = symbolTable.getAllSymbols().filter(s =>
        !s.modulePath || s.modulePath === filePath
    );

    // Convert each symbol to a DocumentSymbol
    for (const symbol of allSymbols) {
        // Determine LSP symbol kind
        let kind: LspSymbolKind;
        switch (symbol.kind) {
            case SymbolKind.Constant:
                kind = LspSymbolKind.Constant;
                break;
            case SymbolKind.Command:
                kind = LspSymbolKind.Function;
                break;
            case SymbolKind.Label:
                kind = LspSymbolKind.String; // Closest to label
                break;
            case SymbolKind.Variable:
                kind = LspSymbolKind.Variable;
                break;
            case SymbolKind.Parameter:
                kind = LspSymbolKind.Variable;
                break;
            default:
                continue; // Skip modules and other types
        }

        // Use authoritative symbol position/length for selection range
        const selectionStart = document.positionAt(symbol.position);
        const selectionEnd = document.positionAt(symbol.position + symbol.length);
        const selectionRange = Range.create(selectionStart, selectionEnd);

        // Use declaration node span for full range
        const fullStart = document.positionAt(symbol.declaration.position);
        const fullEnd = document.positionAt(symbol.declaration.end);
        const fullRange = Range.create(fullStart, fullEnd);

        documentSymbols.push(DocumentSymbol.create(
            symbol.name,
            symbol.type.name,
            kind,
            fullRange,
            selectionRange
        ));
    }

    return documentSymbols;
});

// Rename provider
connection.onRenameRequest(async (params): Promise<{ changes: { [uri: string]: TextEdit[] } } | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const tree = await getOrParseDocument(document);
    const offset = document.offsetAt(params.position);
    const filePath = uriToPath(document.uri);
    let node: RedNode | null = tree.getNodeAtPosition(offset);

    if (!node) {
        return null;
    }

    // Try to find a symbol - either declaration or reference
    let symbol = tree.getSymbolAt(offset, filePath);

    // If not a declaration, walk up to find a reference
    if (!symbol) {
        while (node) {
            symbol = tree.getReferencedSymbol(node);
            if (symbol) {
                break;
            }
            node = node.parent;
        }
    }

    if (!symbol) {
        return null;
    }

    const changes: { [uri: string]: import('vscode-languageserver').TextEdit[] } = {};

    // Helper to add edits from a tree
    const addEditsFromTree = (targetTree: SyntaxTree, targetUri: string) => {
        const targetDoc = documents.get(targetUri);
        const targetFilePath = uriToPath(targetUri);
        const targetSymbolTable = targetTree.getSymbolTable();
        const edits: TextEdit[] = [];

        // Look up the symbol by its unique ID in this tree
        const targetSymbol = targetSymbolTable.getById(symbol!.id);

        if (!targetSymbol) {
            return; // Symbol not visible in this file
        }

        // Add edit for declaration if in this file (not imported)
        if (!targetSymbol.modulePath || targetSymbol.modulePath === targetFilePath) {
            if (targetDoc) {
                const start = targetDoc.positionAt(targetSymbol.position);
                const end = targetDoc.positionAt(targetSymbol.position + targetSymbol.length);
                edits.push({
                    range: { start, end },
                    newText: params.newName
                });
            } else {
                const pos = targetTree.getLineAndColumn(targetSymbol.position);
                edits.push({
                    range: {
                        start: { line: pos.line, character: pos.column },
                        end: { line: pos.line, character: pos.column + targetSymbol.length }
                    },
                    newText: params.newName
                });
            }
        }

        // Add edits for all references in this file to the target symbol
        const references = targetTree.findReferences(targetSymbol);
        for (const ref of references) {
            if (targetDoc) {
                const start = targetDoc.positionAt(ref.position);
                const end = targetDoc.positionAt(ref.position + ref.width);
                edits.push({
                    range: { start, end },
                    newText: params.newName
                });
            } else {
                const pos = targetTree.getLineAndColumn(ref.position);
                edits.push({
                    range: {
                        start: { line: pos.line, character: pos.column },
                        end: { line: pos.line, character: pos.column + ref.width }
                    },
                    newText: params.newName
                });
            }
        }

        if (edits.length > 0) {
            changes[targetUri] = edits;
        }
    };

    // Rename in current file
    addEditsFromTree(tree, params.textDocument.uri);

    // If we have a program, rename in all modules
    if (program) {
        const allModules = program.getAllModules();

        for (const module of allModules) {
            if (module.filePath === filePath) {
                continue; // Already handled current file
            }

            // Rename in all other modules that might reference this symbol
            const moduleUri = URI.file(module.filePath).toString();
            addEditsFromTree(module.tree, moduleUri);
        }
    }

    return { changes };
});

// Semantic tokens provider
connection.languages.semanticTokens.on(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return { data: [] };
    }

    const tree = await getOrParseDocument(document);
    const tokens: number[] = [];

    // Get all tokens from the tree (using getTokens() which correctly filters)
    const redTokens = tree.getRoot().getTokens();

    let prevLine = 0;
    let prevChar = 0;

    for (const token of redTokens) {
        // Skip trivia tokens (we only want actual code tokens)
        if (token.kind >= SyntaxKind.WhitespaceTrivia && token.kind <= SyntaxKind.MultiLineCommentTrivia) {
            continue;
        }

        // Calculate position after leading trivia
        const leadingTriviaWidth = token.getLeadingTrivia().reduce((sum: number, t) => sum + t.width, 0);
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
