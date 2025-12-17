/**
 * SyntaxTree - High-level API for CCScript syntax analysis
 * 
 * This is the main entry point for working with CCScript syntax.
 * It coordinates the Scanner and Parser, provides access to the syntax tree,
 * and offers convenient query methods.
 */

import { Scanner } from './scanner';
import { Parser } from './parser';
import { createRedTree, RedSourceFile, RedNode, RedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import { GreenSourceFile, Diagnostic } from './syntax/types';
import { Binder, BindingResult, SemanticDiagnostic } from './semantic/binder';
import { Symbol, SymbolTable } from './semantic/symbol';
import { Type } from './semantic/types';

/**
 * Represents a parsed CCScript source file with full syntax information
 */
export class SyntaxTree {
    private readonly scanner: Scanner;
    private readonly parser: Parser;
    private readonly greenRoot: GreenSourceFile;
    private redRootCache?: RedSourceFile;
    private diagnosticsCache?: readonly Diagnostic[];
    private bindingCache?: BindingResult;

    private constructor(
        public readonly source: string,
        scanner: Scanner,
        parser: Parser
    ) {
        this.scanner = scanner;
        this.parser = parser;
        this.greenRoot = parser.parseSourceFile();
    }

    /**
     * Parse source code into a syntax tree
     */
    static parse(source: string): SyntaxTree {
        const scanner = new Scanner(source);
        const parser = new Parser(source);
        return new SyntaxTree(source, scanner, parser);
    }

    /**
     * Get the root red node (positioned tree)
     */
    getRoot(): RedSourceFile {
        if (!this.redRootCache) {
            this.redRootCache = createRedTree(this.greenRoot);
        }
        return this.redRootCache;
    }

    /**
     * Get the immutable green tree
     */
    getGreenRoot(): GreenSourceFile {
        return this.greenRoot;
    }

    /**
     * Get all diagnostics (scanner + parser errors)
     */
    getDiagnostics(): readonly Diagnostic[] {
        if (!this.diagnosticsCache) {
            this.diagnosticsCache = [
                ...this.scanner.getDiagnostics(),
                ...this.parser.getDiagnostics(),
            ];
        }
        return this.diagnosticsCache;
    }

    /**
     * Get semantic analysis result (lazy evaluation)
     */
    private getBinding(): BindingResult {
        if (!this.bindingCache) {
            this.bindingCache = Binder.bind(this.getRoot());
        }
        return this.bindingCache;
    }

    /**
     * Get all diagnostics including semantic errors
     */
    getAllDiagnostics(): readonly (Diagnostic | SemanticDiagnostic)[] {
        return [
            ...this.getDiagnostics(),
            ...this.getSemanticDiagnostics(),
        ];
    }

    /**
     * Get semantic diagnostics only
     */
    getSemanticDiagnostics(): readonly SemanticDiagnostic[] {
        return this.getBinding().diagnostics;
    }

    /**
     * Get the symbol table
     */
    getSymbolTable(): SymbolTable {
        return this.getBinding().symbols;
    }

    /**
     * Get the symbol at a specific position
     */
    getSymbolAt(position: number): Symbol | undefined {
        return this.getSymbolTable().getSymbolAt(position);
    }

    /**
     * Get the type of a node
     */
    getTypeOf(node: RedNode): Type | undefined {
        return this.getBinding().types.get(node);
    }

    /**
     * Get the symbol that an identifier references
     */
    getReferencedSymbol(node: RedNode): Symbol | undefined {
        return this.getBinding().references.get(node);
    }

    /**
     * Get the scope ID for a node
     */
    getScopeAt(position: number): number | undefined {
        const node = this.getNodeAtPosition(position);
        return this.getBinding().nodeScopes.get(node.position);
    }

    /**
     * Find all references to a symbol
     */
    findReferences(symbol: Symbol): RedNode[] {
        const references: RedNode[] = [];
        const refMap = this.getBinding().references;

        for (const [node, refSymbol] of refMap.entries()) {
            if (refSymbol === symbol) {
                references.push(node);
            }
        }

        return references;
    }

    /**
     * Find all usages of an identifier (declaration + references)
     */
    findUsages(name: string): RedNode[] {
        const usages: RedNode[] = [];
        const symbols = this.getSymbolTable();
        const matchingSymbols = symbols.getAll(name);

        // Add declarations
        for (const symbol of matchingSymbols) {
            usages.push(symbol.declaration);
        }

        // Add references
        for (const symbol of matchingSymbols) {
            usages.push(...this.findReferences(symbol));
        }

        return usages;
    }

    /**
     * Check if the tree has any errors
     */
    hasErrors(): boolean {
        return this.getDiagnostics().length > 0;
    }

    /**
     * Get the node at a specific position
     */
    getNodeAtPosition(position: number): RedNode {
        return this.getRoot().getNodeAtPosition(position);
    }

    /**
     * Get the token at a specific position
     */
    getTokenAtPosition(position: number): RedToken | undefined {
        const node = this.getNodeAtPosition(position);
        if (node instanceof RedToken) {
            return node;
        }

        // If not a token, find the nearest token
        const tokens = node.getTokens();
        return tokens.find(t => t.containsPosition(position));
    }

    /**
     * Get all statements in the source file
     */
    getStatements(): RedNode[] {
        return this.getRoot().getStatements();
    }

    /**
     * Get all tokens in the tree
     */
    getTokens(): RedToken[] {
        return this.getRoot().getTokens();
    }

    /**
     * Find all nodes of a specific kind
     */
    findNodesOfKind(kind: SyntaxKind): RedNode[] {
        const results: RedNode[] = [];
        const root = this.getRoot();

        const visit = (node: RedNode) => {
            if (node.kind === kind) {
                results.push(node);
            }
            for (const child of node.getChildren()) {
                visit(child);
            }
        };

        visit(root);
        return results;
    }

    /**
     * Find all nodes satisfying a predicate
     */
    findNodes(predicate: (node: RedNode) => boolean): RedNode[] {
        const results: RedNode[] = [];
        const root = this.getRoot();

        const visit = (node: RedNode) => {
            if (predicate(node)) {
                results.push(node);
            }
            for (const child of node.getChildren()) {
                visit(child);
            }
        };

        visit(root);
        return results;
    }

    /**
     * Get text content for a node
     */
    getText(node: RedNode): string {
        return this.source.substring(node.position, node.end);
    }

    /**
     * Get text for a specific range
     */
    getTextRange(start: number, length: number): string {
        return this.source.substring(start, start + length);
    }

    /**
     * Get line and column for a position (zero-based, per LSP spec)
     */
    getLineAndColumn(position: number): { line: number; column: number } {
        let line = 0;
        let columnOffset = 0; // Track last newline position

        for (let i = 0; i < position && i < this.source.length; i++) {
            const ch = this.source[i];

            if (ch === '\r') {
                // Handle CRLF or standalone CR
                if (i + 1 < this.source.length && this.source[i + 1] === '\n') {
                    // CRLF - skip the \r, the \n will be handled next iteration
                    continue;
                } else {
                    // Standalone CR (treat as newline)
                    line++;
                    columnOffset = i + 1; // Next char starts at column 0
                }
            } else if (ch === '\n') {
                line++;
                columnOffset = i + 1; // Next char starts at column 0
            }
        }

        const column = position - columnOffset;
        return { line, column };
    }

    /**
     * Get position from line and column (zero-based, per LSP spec)
     */
    getPosition(line: number, column: number): number {
        let currentLine = 0;
        let lineStartOffset = 0;

        for (let i = 0; i < this.source.length; i++) {
            // Check if we're at the target position
            if (currentLine === line) {
                const currentColumn = i - lineStartOffset;
                if (currentColumn === column) {
                    return i;
                }
            }

            const ch = this.source[i];

            if (ch === '\r') {
                // Handle CRLF or standalone CR
                if (i + 1 < this.source.length && this.source[i + 1] === '\n') {
                    // CRLF - skip the \r, the \n will be handled next iteration
                    continue;
                } else {
                    // Standalone CR (treat as newline)
                    currentLine++;
                    lineStartOffset = i + 1;
                }
            } else if (ch === '\n') {
                currentLine++;
                lineStartOffset = i + 1;
            }
        }

        // Handle case where we're past the end of file
        if (currentLine === line) {
            return Math.min(lineStartOffset + column, this.source.length);
        }

        return this.source.length;
    }

    /**
     * Get all label declarations
     */
    getLabels(): RedNode[] {
        return this.findNodesOfKind(SyntaxKind.LabelDeclaration);
    }

    /**
     * Get all constant declarations
     */
    getConstants(): RedNode[] {
        return this.findNodesOfKind(SyntaxKind.ConstantDeclaration);
    }

    /**
     * Get all command declarations
     */
    getCommands(): RedNode[] {
        return this.findNodesOfKind(SyntaxKind.CommandDeclaration);
    }

    /**
     * Get all identifiers in the tree
     */
    getIdentifiers(): RedToken[] {
        return this.getTokens().filter(t => t.kind === SyntaxKind.Identifier);
    }

    /**
     * Find identifier by name
     */
    findIdentifier(name: string): RedToken | undefined {
        return this.getIdentifiers().find(id => id.text === name);
    }

    /**
     * Find all identifiers with a specific name
     */
    findIdentifiers(name: string): RedToken[] {
        return this.getIdentifiers().filter(id => id.text === name);
    }

    /**
     * Get the source text length
     */
    get length(): number {
        return this.source.length;
    }

    /**
     * Check if position is valid
     */
    isValidPosition(position: number): boolean {
        return position >= 0 && position <= this.source.length;
    }

    /**
     * Get tree statistics
     */
    getStatistics(): TreeStatistics {
        const root = this.getRoot();
        const tokens = this.getTokens();
        const diagnostics = this.getDiagnostics();
        const semanticDiagnostics = this.getSemanticDiagnostics();
        const symbols = this.getSymbolTable();

        return {
            totalNodes: root.getDescendants().length + 1,
            totalTokens: tokens.length,
            totalStatements: this.getStatements().length,
            totalDiagnostics: diagnostics.length,
            totalSemanticDiagnostics: semanticDiagnostics.length,
            totalSymbols: symbols.getAllSymbols().length,
            sourceLength: this.source.length,
            hasErrors: this.hasErrors(),
        };
    }

    /**
     * Create a new syntax tree with updated source
     */
    static update(oldTree: SyntaxTree, newSource: string): SyntaxTree {
        // For now, just reparse. In the future, could implement incremental parsing.
        return SyntaxTree.parse(newSource);
    }
}

/**
 * Statistics about a syntax tree
 */
export interface TreeStatistics {
    totalNodes: number;
    totalTokens: number;
    totalStatements: number;
    totalDiagnostics: number;
    totalSemanticDiagnostics: number;
    totalSymbols: number;
    sourceLength: number;
    hasErrors: boolean;
}
