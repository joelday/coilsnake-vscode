/**
 * CCScript language server: wires LSP requests to the workspace and features.
 */

import {
    CodeActionKind,
    Connection,
    InitializeParams,
    InitializeResult,
    ResponseError,
    TextDocumentSyncKind,
    TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { provideCodeActions } from './features/codeActions';
import { CONVERT_FILE_KIND, resolveConvertFileAction } from './features/convertControlCodes';
import { provideCompletion } from './features/completion';
import { provideHover } from './features/hover';
import { provideInlayHints } from './features/inlayHints';
import {
    prepareRename,
    provideDefinition,
    provideDocumentHighlights,
    provideReferences,
    provideRename,
} from './features/navigation';
import { provideDocumentSymbols, provideWorkspaceSymbols } from './features/outline';
import { provideSemanticTokens, semanticTokensLegend } from './features/semanticTokens';
import { provideSignatureHelp } from './features/signatureHelp';
import { provideDocumentLinks, provideFoldingRanges } from './features/structure';
import { Analysis, ServerOptions, Workspace } from './workspace';

export type { ServerOptions } from './workspace';

export function startServer(connection: Connection, options: ServerOptions = {}): Workspace {
    const documents = new TextDocuments(TextDocument);
    const workspace = new Workspace(connection, documents, options);
    let snippetSupport = false;

    /**
     * Run a feature against an up-to-date analysis of the document. Unexpected errors are
     * logged rather than failing the request; ResponseErrors (e.g. "can't rename this")
     * are passed on to the client.
     */
    function withAnalysis<T>(uri: string, fallback: T, feature: (analysis: Analysis) => T | Promise<T>): Promise<T> {
        return (async () => {
            const analysis = await workspace.getAnalysis(uri);
            if (!analysis) {
                return fallback;
            }
            try {
                return await feature(analysis);
            } catch (error) {
                if (error instanceof ResponseError) {
                    throw error;
                }
                workspace.log(`Error handling a request for ${uri}: ${error instanceof Error ? error.stack : error}`);
                return fallback;
            }
        })();
    }

    connection.onInitialize((params: InitializeParams): InitializeResult => {
        workspace.initialize(params);
        snippetSupport = !!params.capabilities.textDocument?.completion?.completionItem?.snippetSupport;

        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                // '(' and ',' only offer game data (items, characters...) for arguments that take it
                completionProvider: { triggerCharacters: ['.', '"', '/', '(', ','] },
                hoverProvider: true,
                signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
                definitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                renameProvider: { prepareProvider: true },
                semanticTokensProvider: { legend: semanticTokensLegend, full: true },
                foldingRangeProvider: true,
                documentLinkProvider: { resolveProvider: false },
                codeActionProvider: {
                    codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite, CONVERT_FILE_KIND],
                    resolveProvider: true,
                },
                inlayHintProvider: true,
            },
        };
    });

    documents.onDidChangeContent(change => workspace.documentChanged(change.document));
    documents.onDidClose(event => void workspace.documentClosed(event.document));
    connection.onDidChangeWatchedFiles(params => void workspace.filesChanged(params.changes));
    connection.onDidChangeConfiguration(params => void workspace.configurationChanged(params.settings));

    connection.onCompletion(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideCompletion(workspace, analysis, params, { snippetSupport })));
    connection.onHover(params => withAnalysis(params.textDocument.uri, null,
        analysis => provideHover(workspace, analysis, params)));
    connection.onSignatureHelp(params => withAnalysis(params.textDocument.uri, null,
        analysis => provideSignatureHelp(workspace, analysis, params)));
    connection.onDefinition(params => withAnalysis(params.textDocument.uri, null,
        analysis => provideDefinition(workspace, analysis, params)));
    connection.onReferences(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideReferences(workspace, analysis, params)));
    connection.onDocumentHighlight(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideDocumentHighlights(workspace, analysis, params)));
    connection.onDocumentSymbol(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideDocumentSymbols(workspace, analysis)));
    connection.onWorkspaceSymbol(params => provideWorkspaceSymbols(workspace, params));
    connection.onPrepareRename(params => withAnalysis(params.textDocument.uri, null,
        analysis => prepareRename(workspace, analysis, params)));
    connection.onRenameRequest(params => withAnalysis(params.textDocument.uri, null,
        analysis => provideRename(workspace, analysis, params)));
    connection.languages.semanticTokens.on(params => withAnalysis(params.textDocument.uri, { data: [] },
        analysis => provideSemanticTokens(workspace, analysis)));
    connection.onFoldingRanges(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideFoldingRanges(analysis)));
    connection.onDocumentLinks(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideDocumentLinks(workspace, analysis)));
    connection.languages.inlayHint.on(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideInlayHints(workspace, analysis, params)));
    connection.onCodeActionResolve(action => {
        const uri = (action.data as { uri?: string } | undefined)?.uri;
        return uri && action.kind === CONVERT_FILE_KIND
            ? withAnalysis(uri, action, analysis => resolveConvertFileAction(workspace, analysis, action))
            : action;
    });
    connection.onCodeAction(params => withAnalysis(params.textDocument.uri, [],
        analysis => provideCodeActions(workspace, analysis, params)));

    documents.listen(connection);
    connection.listen();
    return workspace;
}
