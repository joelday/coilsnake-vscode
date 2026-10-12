/**
 * CCScript Project Explorer Tree View
 * Displays loaded CCScript modules and their structure in VS Code's explorer panel
 */

import * as vscode from 'vscode';

/**
 * Tree item types for the project explorer
 */
export enum CCScriptTreeItemType {
    Module = 'module',
    ImportsSection = 'imports-section',
    Import = 'import',
    LabelsSection = 'labels-section',
    Label = 'label',
    CommandsSection = 'commands-section',
    Command = 'command',
    ConstantsSection = 'constants-section',
    Constant = 'constant'
}

/**
 * Data structure for tree items
 */
export interface CCScriptTreeItemData {
    type: CCScriptTreeItemType;
    label: string;
    description?: string;
    filePath?: string;
    position?: vscode.Position;
    children?: CCScriptTreeItemData[];
}

/**
 * Tree item for the CCScript project explorer
 */
export class CCScriptTreeItem extends vscode.TreeItem {
    constructor(
        public readonly data: CCScriptTreeItemData,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(data.label, collapsibleState);

        this.description = data.description;
        this.tooltip = data.label;

        // Set icon based on type
        switch (data.type) {
            case CCScriptTreeItemType.Module:
                this.iconPath = new vscode.ThemeIcon('file-code');
                this.resourceUri = data.filePath ? vscode.Uri.file(data.filePath) : undefined;
                this.contextValue = 'ccscript-module';
                break;
            case CCScriptTreeItemType.ImportsSection:
                this.iconPath = new vscode.ThemeIcon('references');
                this.contextValue = 'ccscript-imports-section';
                break;
            case CCScriptTreeItemType.Import:
                this.iconPath = new vscode.ThemeIcon('file-symlink-file');
                this.contextValue = 'ccscript-import';
                break;
            case CCScriptTreeItemType.LabelsSection:
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                this.contextValue = 'ccscript-labels-section';
                break;
            case CCScriptTreeItemType.Label:
                this.iconPath = new vscode.ThemeIcon('bookmark');
                this.contextValue = 'ccscript-label';
                break;
            case CCScriptTreeItemType.CommandsSection:
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                this.contextValue = 'ccscript-commands-section';
                break;
            case CCScriptTreeItemType.Command:
                this.iconPath = new vscode.ThemeIcon('symbol-function');
                this.contextValue = 'ccscript-command';
                break;
            case CCScriptTreeItemType.ConstantsSection:
                this.iconPath = new vscode.ThemeIcon('symbol-constant');
                this.contextValue = 'ccscript-constants-section';
                break;
            case CCScriptTreeItemType.Constant:
                this.iconPath = new vscode.ThemeIcon('symbol-numeric');
                this.contextValue = 'ccscript-constant';
                break;
        }

        // Set command to open file at position
        if (data.filePath && data.position) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [
                    vscode.Uri.file(data.filePath),
                    {
                        selection: new vscode.Range(data.position, data.position),
                        preview: true
                    }
                ]
            };
        } else if (data.filePath && data.type === CCScriptTreeItemType.Module) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(data.filePath)]
            };
        }
    }
}

/**
 * Tree data provider for CCScript project explorer
 */
export class CCScriptProjectExplorer implements vscode.TreeDataProvider<CCScriptTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CCScriptTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private modules: CCScriptTreeItemData[] = [];

    constructor() { }

    /**
     * Update the tree with new module data
     */
    updateModules(modules: CCScriptTreeItemData[]): void {
        this.modules = modules;
        this._onDidChangeTreeData.fire();
    }

    /**
     * Clear all modules
     */
    clear(): void {
        this.modules = [];
        this._onDidChangeTreeData.fire();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CCScriptTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CCScriptTreeItem): Thenable<CCScriptTreeItem[]> {
        if (!element) {
            // Root level - return all modules
            if (this.modules.length === 0) {
                return Promise.resolve([]);
            }

            return Promise.resolve(
                this.modules.map(m => new CCScriptTreeItem(
                    m,
                    m.children && m.children.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                ))
            );
        }

        // Return children of the element
        if (element.data.children && element.data.children.length > 0) {
            return Promise.resolve(
                element.data.children.map(child => new CCScriptTreeItem(
                    child,
                    child.children && child.children.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                ))
            );
        }

        return Promise.resolve([]);
    }

    getParent(_element: CCScriptTreeItem): vscode.ProviderResult<CCScriptTreeItem> {
        // Not implementing parent navigation for now
        return null;
    }
}
