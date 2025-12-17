/**
 * VS Code Extension for CCScript
 * 
 * This extension provides CCScript language support in VS Code by
 * connecting to the CCScript Language Server.
 */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // The server is implemented in the sibling package
    const serverModule = context.asAbsolutePath(
        path.join('..', 'ccscript-language-server', 'out', 'server.js')
    );

    // Debug options for the server
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for CCScript documents
        documentSelector: [{ scheme: 'file', language: 'ccscript' }],
        synchronize: {
            // Notify the server about file changes to '.ccs' files in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/*.ccs')
        }
    };

    // Create the language client and start the client
    client = new LanguageClient(
        'ccscriptLanguageServer',
        'CCScript Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
