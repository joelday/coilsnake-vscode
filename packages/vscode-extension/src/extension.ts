/**
 * VS Code Extension for CCScript
 * 
 * This extension provides CCScript language support in VS Code by
 * connecting to the CCScript Language Server.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { workspace, ExtensionContext } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

import { CCScriptProjectExplorer, CCScriptTreeItemData, CCScriptTreeItemType } from './projectExplorer';

let client: LanguageClient;
let projectExplorer: CCScriptProjectExplorer;

export function activate(context: ExtensionContext) {
    // Create and register project explorer
    projectExplorer = new CCScriptProjectExplorer();
    const treeView = vscode.window.createTreeView('ccscript-project-explorer', {
        treeDataProvider: projectExplorer,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    // Register refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('ccscript.refreshProjectExplorer', () => {
            projectExplorer.refresh();
        })
    );

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
    client.start().then(() => {
        // Once the client is ready, scan for CCScript files and update tree
        updateProjectExplorer();

        // Watch for file changes and update tree
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.ccs');
        context.subscriptions.push(watcher);
        
        watcher.onDidCreate(() => updateProjectExplorer());
        watcher.onDidChange(() => updateProjectExplorer());
        watcher.onDidDelete(() => updateProjectExplorer());
    });
}

/**
 * Scan workspace for CCScript files and update the project explorer
 */
async function updateProjectExplorer(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        projectExplorer.clear();
        return;
    }

    const modules: CCScriptTreeItemData[] = [];

    // Find all .ccs files in the workspace
    for (const folder of workspaceFolders) {
        const pattern = new vscode.RelativePattern(folder, '**/*.ccs');
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

        for (const fileUri of files) {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const fileName = path.basename(fileUri.fsPath);
            const moduleName = path.basename(fileUri.fsPath, '.ccs');

            // Parse the document to extract structure (simplified for now)
            const children: CCScriptTreeItemData[] = [];

            // Find imports (lines starting with 'import')
            const imports: CCScriptTreeItemData[] = [];
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const importMatch = line.text.match(/^\s*import\s+(["']?)([^"'\s]+)\1/);
                if (importMatch) {
                    imports.push({
                        type: CCScriptTreeItemType.Import,
                        label: importMatch[2],
                        filePath: fileUri.fsPath,
                        position: new vscode.Position(i, 0)
                    });
                }
            }

            if (imports.length > 0) {
                children.push({
                    type: CCScriptTreeItemType.ImportsSection,
                    label: `Imports (${imports.length})`,
                    children: imports
                });
            }

            // Find labels (lines ending with ':')
            const labels: CCScriptTreeItemData[] = [];
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const labelMatch = line.text.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
                if (labelMatch) {
                    labels.push({
                        type: CCScriptTreeItemType.Label,
                        label: labelMatch[1],
                        filePath: fileUri.fsPath,
                        position: new vscode.Position(i, 0)
                    });
                }
            }

            if (labels.length > 0) {
                children.push({
                    type: CCScriptTreeItemType.LabelsSection,
                    label: `Labels (${labels.length})`,
                    children: labels
                });
            }

            // Find command definitions (lines starting with 'command')
            const commands: CCScriptTreeItemData[] = [];
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const commandMatch = line.text.match(/^\s*command\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (commandMatch) {
                    commands.push({
                        type: CCScriptTreeItemType.Command,
                        label: commandMatch[1],
                        filePath: fileUri.fsPath,
                        position: new vscode.Position(i, 0)
                    });
                }
            }

            if (commands.length > 0) {
                children.push({
                    type: CCScriptTreeItemType.CommandsSection,
                    label: `Commands (${commands.length})`,
                    children: commands
                });
            }

            // Find constants (lines starting with 'define')
            const constants: CCScriptTreeItemData[] = [];
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const constantMatch = line.text.match(/^\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (constantMatch) {
                    constants.push({
                        type: CCScriptTreeItemType.Constant,
                        label: constantMatch[1],
                        filePath: fileUri.fsPath,
                        position: new vscode.Position(i, 0)
                    });
                }
            }

            if (constants.length > 0) {
                children.push({
                    type: CCScriptTreeItemType.ConstantsSection,
                    label: `Constants (${constants.length})`,
                    children: constants
                });
            }

            modules.push({
                type: CCScriptTreeItemType.Module,
                label: fileName,
                description: moduleName,
                filePath: fileUri.fsPath,
                children: children.length > 0 ? children : undefined
            });
        }
    }

    projectExplorer.updateModules(modules);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
