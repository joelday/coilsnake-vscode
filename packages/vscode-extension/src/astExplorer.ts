/**
 * CCScript AST Explorer Tree View
 * Displays the Abstract Syntax Tree of the currently active CCScript file
 */

import * as vscode from 'vscode';
import { SyntaxTree, RedNode, RedToken, SyntaxKind, isRedToken, GreenTrivia } from 'ccscript-core';

/**
 * Represents a trivia item (whitespace, comment, etc.)
 */
interface TriviaItem {
    kind: SyntaxKind;
    text: string;
    width: number;
    position: number;
}

/**
 * Represents a grouping of trivia items (leading or trailing)
 */
interface TriviaGroup {
    type: 'leading' | 'trailing';
    items: readonly { kind: SyntaxKind; text: string; width: number }[];
    position: number;
    fullWidth: number;
}

/**
 * Tree item that can represent an AST node, trivia group, or individual trivia
 */
type ASTItem =
    | { type: 'node'; node: RedNode }
    | { type: 'trivia'; trivia: TriviaItem }
    | { type: 'triviaGroup'; group: TriviaGroup };

/**
 * Tree item for AST nodes and trivia
 */
export class ASTTreeItem extends vscode.TreeItem {
    constructor(
        public readonly item: ASTItem,
        public readonly document: vscode.TextDocument,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        let label: string;
        let position: number;
        let width: number;

        if (item.type === 'triviaGroup') {
            // Trivia group node
            label = item.group.type === 'leading' ? 'LeadingTrivia' : 'TrailingTrivia';
            position = item.group.position;
            width = item.group.fullWidth;
        } else if (item.type === 'trivia') {
            // Individual trivia item
            const kind = item.trivia.kind;
            const kindName = SyntaxKind[kind];
            const displayText = item.trivia.text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
            const truncated = displayText.length > 30
                ? displayText.substring(0, 30) + '...'
                : displayText;
            label = `${kindName}: "${truncated}"`;
            position = item.trivia.position;
            width = item.trivia.width;
        } else {
            // AST node
            const kind = item.node.kind;
            const kindName = SyntaxKind[kind];
            label = kindName;

            if (item.node instanceof RedToken && item.node.width > 0) {
                const text = document.getText(new vscode.Range(
                    document.positionAt(item.node.position),
                    document.positionAt(item.node.position + item.node.width)
                ));
                const displayText = text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                const truncated = displayText.length > 30
                    ? displayText.substring(0, 30) + '...'
                    : displayText;
                label = `${kindName}: "${truncated}"`;
            }

            position = item.node.position;
            width = item.node.width;
        }

        super(label, collapsibleState);

        this.description = `[${position}..${position + width})`;
        this.tooltip = this.createTooltip();

        if (item.type === 'triviaGroup') {
            this.contextValue = 'ast-trivia-group';
            this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        } else if (item.type === 'trivia') {
            this.contextValue = 'ast-trivia';
            this.iconPath = new vscode.ThemeIcon('symbol-text');
        } else {
            this.contextValue = item.node instanceof RedToken ? 'ast-token' : 'ast-node';
            this.iconPath = item.node instanceof RedToken
                ? new vscode.ThemeIcon('symbol-text')
                : new vscode.ThemeIcon('symbol-structure');
        }

        // Set command to navigate to the position
        // Set command to reveal in editor
        const revealTarget = item.type === 'triviaGroup' ? item.group :
            item.type === 'trivia' ? item.trivia :
                item.node;
        this.command = {
            command: 'ccscript.revealASTNode',
            title: 'Reveal in Editor',
            arguments: [revealTarget, this.document]
        };
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();

        if (this.item.type === 'triviaGroup') {
            const group = this.item.group;
            tooltip.appendMarkdown(`**${group.type === 'leading' ? 'Leading' : 'Trailing'} Trivia**\n\n`);
            tooltip.appendMarkdown(`Position: ${group.position}\n\n`);
            tooltip.appendMarkdown(`Full Width: ${group.fullWidth}\n\n`);
            tooltip.appendMarkdown(`Items: ${group.items.length}\n\n`);
        } else if (this.item.type === 'trivia') {
            const trivia = this.item.trivia;
            tooltip.appendMarkdown(`**${SyntaxKind[trivia.kind]}** (Trivia)\n\n`);
            tooltip.appendMarkdown(`Position: ${trivia.position}\n\n`);
            tooltip.appendMarkdown(`Width: ${trivia.width}\n\n`);
            tooltip.appendMarkdown(`Text: \`${trivia.text.replace(/`/g, '\\`')}\`\n\n`);
        } else {
            // Node type
            const node = this.item.node;
            tooltip.appendMarkdown(`**${SyntaxKind[node.kind]}**\n\n`);
            tooltip.appendMarkdown(`Position: ${node.position}\n\n`);
            tooltip.appendMarkdown(`Width: ${node.width}\n\n`);

            if (node instanceof RedToken && node.width > 0) {
                const text = this.document.getText(new vscode.Range(
                    this.document.positionAt(node.position),
                    this.document.positionAt(node.position + node.width)
                ));
                tooltip.appendMarkdown(`Text: \`${text.replace(/`/g, '\\`')}\`\n\n`);
            }
        }

        return tooltip;
    }
}

/**
 * Tree data provider for AST Explorer
 */
export class ASTExplorer implements vscode.TreeDataProvider<ASTTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ASTTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentTree: SyntaxTree | null = null;
    private currentDocument: vscode.TextDocument | null = null;

    constructor() { }

    /**
     * Update the tree with a new document
     */
    updateDocument(document: vscode.TextDocument | null): void {
        if (!document || document.languageId !== 'ccscript') {
            this.currentTree = null;
            this.currentDocument = null;
            this._onDidChangeTreeData.fire();
            return;
        }

        this.currentDocument = document;
        this.currentTree = SyntaxTree.parse(document.getText());
        this._onDidChangeTreeData.fire();
    }

    /**
     * Refresh the current tree
     */
    refresh(): void {
        if (this.currentDocument) {
            this.updateDocument(this.currentDocument);
        } else {
            this._onDidChangeTreeData.fire();
        }
    }

    getTreeItem(element: ASTTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ASTTreeItem): Thenable<ASTTreeItem[]> {
        if (!this.currentTree || !this.currentDocument) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level - return the root node
            const root = this.currentTree.getRoot();
            return Promise.resolve([
                new ASTTreeItem(
                    { type: 'node', node: root },
                    this.currentDocument,
                    root.getChildren().length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None
                )
            ]);
        }

        // Trivia items have no children
        if (element.item.type === 'trivia') {
            return Promise.resolve([]);
        }

        // Trivia groups expand to show individual trivia items
        if (element.item.type === 'triviaGroup') {
            const group = element.item.group;
            let currentPos = group.position;
            const triviaItems = group.items.map(trivia => {
                const item = new ASTTreeItem(
                    { type: 'trivia', trivia: { ...trivia, position: currentPos } },
                    this.currentDocument!,
                    vscode.TreeItemCollapsibleState.None
                );
                currentPos += trivia.width;
                return item;
            });
            return Promise.resolve(triviaItems);
        }

        const node = element.item.node;
        const items: ASTTreeItem[] = [];

        // For tokens, create trivia group nodes
        if (isRedToken(node)) {
            const leadingTrivia = node.getLeadingTrivia();
            const trailingTrivia = node.getTrailingTrivia();

            // Add leading trivia group if present
            if (leadingTrivia.length > 0) {
                const leadingWidth = leadingTrivia.reduce((sum: number, t: GreenTrivia) => sum + t.width, 0);
                items.push(new ASTTreeItem(
                    {
                        type: 'triviaGroup',
                        group: {
                            type: 'leading',
                            items: leadingTrivia,
                            position: node.position,
                            fullWidth: leadingWidth
                        }
                    },
                    this.currentDocument!,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            }

            // Add trailing trivia group if present
            if (trailingTrivia.length > 0) {
                const trailingWidth = trailingTrivia.reduce((sum: number, t: GreenTrivia) => sum + t.width, 0);
                const trailingStart = node.position + node.fullWidth - trailingWidth;
                items.push(new ASTTreeItem(
                    {
                        type: 'triviaGroup',
                        group: {
                            type: 'trailing',
                            items: trailingTrivia,
                            position: trailingStart,
                            fullWidth: trailingWidth
                        }
                    },
                    this.currentDocument!,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            }

            return Promise.resolve(items);
        }

        // For non-tokens, just return child nodes
        const children = node.getChildren();
        return Promise.resolve(
            children.map((child: RedNode) => new ASTTreeItem(
                { type: 'node', node: child },
                this.currentDocument!,
                child.getChildren().length > 0 || (isRedToken(child) && (child.getLeadingTrivia().length > 0 || child.getTrailingTrivia().length > 0))
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            ))
        );
    }

    getParent(element: ASTTreeItem): vscode.ProviderResult<ASTTreeItem> {
        if (element.item.type === 'trivia' || element.item.type === 'triviaGroup') {
            // Trivia and trivia groups don't have a parent in the tree structure
            return null;
        }

        // Node type
        const parent = element.item.node.parent;
        if (!parent || !this.currentDocument) {
            return null;
        }

        return new ASTTreeItem(
            { type: 'node', node: parent },
            this.currentDocument,
            parent.getChildren().length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );
    }
}

/**
 * Reveal an AST node, trivia, or trivia group in the editor
 */
export function revealASTNode(item: RedNode | TriviaItem | TriviaGroup, document: vscode.TextDocument): void {
    const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
    if (!editor) {
        return;
    }

    // Determine position and width based on item type
    let position: number;
    let width: number;

    if ('green' in item) {
        // It's a RedNode
        position = item.position;
        width = item.width;
    } else if ('items' in item) {
        // It's a TriviaGroup
        position = item.position;
        width = item.fullWidth;
    } else {
        // It's a TriviaItem
        position = item.position;
        width = item.width;
    }

    const startPos = document.positionAt(position);
    const endPos = document.positionAt(position + width);
    const range = new vscode.Range(startPos, endPos);

    editor.selection = new vscode.Selection(startPos, endPos);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
