/**
 * Red Node Implementation
 * 
 * Red nodes wrap green nodes with position and parent information,
 * enabling efficient tree navigation without modifying immutable green nodes.
 * 
 * Key design principles:
 * - Lazy creation and caching of child red nodes
 * - Parent pointer for upward traversal
 * - Absolute position tracking
 * - Efficient memory usage through on-demand instantiation
 */

import { SyntaxKind } from './syntax/syntaxKind';
import {
    GreenNode,
    GreenToken,
    GreenSourceFile,
    RedNode as IRedNode,
    IRedToken,
} from './syntax/types';
import * as Syntax from './syntax/syntaxKind';

/**
 * Base red node wrapping a green node with position
 */
export class RedNode implements IRedNode {
    private childrenCache?: RedNode[];

    constructor(
        public readonly green: GreenNode,
        public readonly parent: RedNode | null,
        public readonly position: number
    ) { }

    /**
     * Get the syntax kind of this node
     */
    get kind(): SyntaxKind {
        return this.green.kind;
    }

    /**
     * Get the fullWidth (total length including trivia)
     */
    get fullWidth(): number {
        return this.green.fullWidth;
    }

    /**
     * Get the width (length without trivia) - computed from fullWidth
     * For tokens: text.length
     * For nodes: fullWidth - leadingTriviaWidth - trailingTriviaWidth
     */
    get width(): number {
        if ('text' in this.green) {
            // Token: width is just text length
            return (this.green as GreenToken).text.length;
        }
        // Node: width excludes trivia from first and last tokens
        const leadingWidth = this.getLeadingTriviaWidth();
        const trailingWidth = this.getTrailingTriviaWidth();
        return this.green.fullWidth - leadingWidth - trailingWidth;
    }

    /**
     * Get the end position (position + fullWidth)
     */
    get end(): number {
        return this.position + this.fullWidth;
    }

    /**
     * Get text span for this node (excluding trivia)
     * This is the span of the actual token/node text, not including leading/trailing trivia
     */
    get span(): { start: number; length: number } {
        const leadingWidth = this.getLeadingTriviaWidth();
        return {
            start: this.position + leadingWidth,
            length: this.width
        };
    }

    /**
     * Get full span including trivia
     */
    get fullSpan(): { start: number; length: number } {
        return { start: this.position, length: this.fullWidth };
    }

    /**
     * Get leading trivia width
     */
    getLeadingTriviaWidth(): number {
        if ('leadingTrivia' in this.green) {
            const leadingTrivia = (this.green as GreenToken).leadingTrivia;
            return leadingTrivia?.reduce((sum, t) => sum + t.width, 0) ?? 0;
        }
        // For nodes, recursively get first token's leading trivia
        const firstChild = this.getFirstChild();
        return firstChild ? firstChild.getLeadingTriviaWidth() : 0;
    }

    /**
     * Get trailing trivia width
     */
    getTrailingTriviaWidth(): number {
        if ('trailingTrivia' in this.green) {
            const trailingTrivia = (this.green as GreenToken).trailingTrivia;
            return trailingTrivia?.reduce((sum, t) => sum + t.width, 0) ?? 0;
        }
        // For nodes, recursively get last token's trailing trivia
        const lastChild = this.getLastChild();
        return lastChild ? lastChild.getTrailingTriviaWidth() : 0;
    }

    /**
     * Get text span for this node (method version for compatibility)
     */
    getSpan(): { start: number; length: number } {
        return this.span;
    }

    /**
     * Get all child red nodes (lazily created and cached)
     */
    getChildren(): readonly RedNode[] {
        if (!this.childrenCache) {
            this.childrenCache = this.createChildren();
        }
        return this.childrenCache;
    }

    /**
     * Get child at specific index
     */
    getChildAt(index: number): RedNode | null {
        const children = this.getChildren();
        return children[index] ?? null;
    }

    /**
     * Get number of children
     */
    getChildCount(): number {
        return this.green.children?.length ?? 0;
    }

    /**
     * Get first child
     */
    getFirstChild(): RedNode | null {
        return this.getChildAt(0);
    }

    /**
     * Get last child
     */
    getLastChild(): RedNode | null {
        const count = this.getChildCount();
        return count > 0 ? this.getChildAt(count - 1) : null;
    }

    /**
     * Get child containing position
     */
    getChildAtPosition(pos: number): RedNode | null {
        const children = this.getChildren();

        for (const child of children) {
            if (pos >= child.position && pos < child.end) {
                return child;
            }
        }

        return null;
    }

    /**
     * Get deepest node containing position
     */
    getNodeAtPosition(pos: number): RedNode {
        const findDeepest = (node: RedNode): RedNode => {
            const child = node.getChildAtPosition(pos);
            if (!child) {
                return node;
            }
            return findDeepest(child);
        };

        return findDeepest(this);
    }

    /**
     * Get all ancestor nodes (parent, grandparent, etc.)
     */
    getAncestors(): RedNode[] {
        const ancestors: RedNode[] = [];
        let currentNode = this.parent;

        while (currentNode) {
            ancestors.push(currentNode);
            currentNode = currentNode.parent;
        }

        return ancestors;
    }

    /**
     * Get first ancestor of specific kind
     */
    getAncestorOfKind(kind: SyntaxKind): RedNode | null {
        return this.getAncestors().find(node => node.kind === kind) ?? null;
    }

    /**
     * Get all descendant nodes in pre-order
     */
    getDescendants(): RedNode[] {
        const descendants: RedNode[] = [];

        const visit = (node: RedNode) => {
            const children = node.getChildren();
            for (const child of children) {
                descendants.push(child);
                visit(child);
            }
        };

        visit(this);
        return descendants;
    }

    /**
     * Get all tokens in this subtree
     */
    getTokens(): RedToken[] {
        const tokens: RedToken[] = [];

        const visit = (node: RedNode) => {
            if (isRedToken(node)) {
                tokens.push(node);
            } else {
                for (const child of node.getChildren()) {
                    visit(child);
                }
            }
        };

        visit(this);
        return tokens;
    }

    /**
     * Get previous sibling
     */
    getPreviousSibling(): RedNode | null {
        if (!this.parent) {
            return null;
        }

        const siblings = this.parent.getChildren();
        const index = siblings.indexOf(this);
        return index > 0 ? siblings[index - 1] ?? null : null;
    }

    /**
     * Get next sibling
     */
    getNextSibling(): RedNode | null {
        if (!this.parent) {
            return null;
        }

        const siblings = this.parent.getChildren();
        const index = siblings.indexOf(this);
        return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null;
    }

    /**
     * Check if this node contains a position
     */
    containsPosition(pos: number): boolean {
        return pos >= this.position && pos < this.end;
    }

    /**
     * Check if this node is an ancestor of another node
     */
    isAncestorOf(node: RedNode): boolean {
        let current = node.parent;
        while (current) {
            if (current === this) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    /**
     * Check if this node is a descendant of another node
     */
    isDescendantOf(node: RedNode): boolean {
        return node.isAncestorOf(this);
    }

    /**
     * Get the root node
     */
    getRoot(): RedNode {
        if (!this.parent) {
            return this;
        }
        return this.parent.getRoot();
    }

    /**
     * Create child red nodes
     * Position advances by fullWidth (including trivia) of each child
     */
    private createChildren(): RedNode[] {
        const children: RedNode[] = [];
        const greenChildren = this.green.children;

        if (!greenChildren) {
            return children;
        }

        let childPosition = this.position;

        for (const greenChild of greenChildren) {
            const redChild = createRedNode(greenChild, this, childPosition);
            children.push(redChild);
            childPosition += greenChild.fullWidth;  // Use fullWidth to include trivia
        }

        return children;
    }

    /**
     * Get text content if this is a token
     */
    getText(): string | null {
        if ('text' in this.green) {
            return (this.green as GreenToken).text;
        }
        return null;
    }

    /**
     * Find the first child of a specific kind
     */
    findChildByKind(kind: SyntaxKind): RedNode | null {
        const children = this.getChildren();
        return children.find(c => c.kind === kind) ?? null;
    }

    /**
     * Find all children of a specific kind
     */
    findChildrenByKind(kind: SyntaxKind): RedNode[] {
        const children = this.getChildren();
        return children.filter(c => c.kind === kind);
    }

    /**
     * Get the identifier token for this declaration/reference node.
     * Searches for the first Identifier token in the node's children.
     * This provides an authoritative reference for the name token.
     */
    getIdentifierToken(): RedToken | null {
        const identifier = this.findChildByKind(SyntaxKind.Identifier);
        if (identifier && isRedToken(identifier)) {
            return identifier;
        }
        return null;
    }

    /**
     * Get the name of this node if it has an identifier.
     * Returns the text of the identifier token, or null if not found.
     */
    getIdentifierName(): string | null {
        const token = this.getIdentifierToken();
        return token?.text ?? null;
    }
}

/**
 * Red node for tokens (leaf nodes with text)
 */
export class RedToken extends RedNode implements IRedToken {
    // Override to narrow type
    declare readonly green: GreenToken;

    constructor(
        green: GreenToken,
        parent: RedNode | null,
        position: number
    ) {
        super(green, parent, position);
    }

    /**
     * Get token text
     */
    get text(): string {
        return this.green.text;
    }

    /**
     * Get leading trivia
     */
    getLeadingTrivia(): readonly { kind: SyntaxKind; text: string; width: number }[] {
        return (this.green as GreenToken).leadingTrivia || [];
    }

    /**
     * Get trailing trivia
     */
    getTrailingTrivia(): readonly { kind: SyntaxKind; text: string; width: number }[] {
        return (this.green as GreenToken).trailingTrivia || [];
    }

    /**
     * Tokens have no children
     */
    getChildren(): readonly RedNode[] {
        return [];
    }
}

/**
 * Red node for source file (root node)
 */
export class RedSourceFile extends RedNode {
    constructor(green: GreenSourceFile, position: number = 0) {
        super(green, null, position);
    }

    get greenSourceFile(): GreenSourceFile {
        return this.green as GreenSourceFile;
    }

    /**
     * Get all statements in the source file
     */
    getStatements(): RedNode[] {
        // Statements are all children except the EOF token
        const children = this.getChildren();
        return children.slice(0, -1); // Remove EOF token
    }

    /**
     * Get EOF token
     */
    getEndOfFileToken(): RedToken {
        const children = this.getChildren();
        return children[children.length - 1] as RedToken;
    }
}

/**
 * Factory function to create appropriate red node type
 */
export function createRedNode(
    green: GreenNode,
    parent: RedNode | null,
    position: number
): RedNode {
    // Check if it's a token (has text property)
    if ('text' in green) {
        return new RedToken(green as GreenToken, parent, position);
    }

    // Check if it's a source file
    if (green.kind === SyntaxKind.SourceFile) {
        return new RedSourceFile(green as GreenSourceFile, position);
    }

    // Default red node for all other node types
    return new RedNode(green, parent, position);
}

/**
 * Create red tree from green tree
 */
export function createRedTree(green: GreenSourceFile): RedSourceFile {
    return new RedSourceFile(green, 0);
}

/**
 * Type guard to check if a node is a token
 * 
 * This is the canonical way to check if a RedNode is a token.
 * Uses the syntax kind to determine token-ness.
 */
export function isRedToken(node: RedNode): node is RedNode & IRedToken {
    return Syntax.SyntaxKind.isToken(node.kind);
}
