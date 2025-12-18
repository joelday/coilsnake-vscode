/**
 * SyntaxTree - High-level API for CCScript syntax analysis
 * 
 * This is the main entry point for working with CCScript syntax.
 * It coordinates the Scanner and Parser, provides access to the syntax tree,
 * and offers convenient query methods.
 */

import { Scanner } from './scanner';
import { Parser } from './parser';
import { createRedTree, RedSourceFile, RedNode, RedToken, isRedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import { GreenSourceFile, Diagnostic } from './syntax/types';
import { Binder, BindingResult, SemanticDiagnostic, ModuleResolver } from './semantic/binder';
import { Symbol, SymbolTable } from './semantic/symbol';
import { Type } from './semantic/types';
import type { Module } from './program';

/**
 * Represents a parsed CCScript source file with full syntax information
 */
export class SyntaxTree {
    private readonly scanner: Scanner;
    private readonly parser: Parser;
    private readonly greenRoot: GreenSourceFile;
    private readonly moduleResolver?: ModuleResolver;
    private readonly siblingModules?: Module[];
    private redRootCache?: RedSourceFile;
    private diagnosticsCache?: readonly Diagnostic[];
    private bindingCache?: BindingResult;
    private isBinding = false; // Prevent re-entry during sibling imports

    private constructor(
        public readonly source: string,
        scanner: Scanner,
        parser: Parser,
        moduleResolver?: ModuleResolver,
        siblingModules?: Module[]
    ) {
        this.scanner = scanner;
        this.parser = parser;
        this.greenRoot = parser.parseSourceFile();
        this.moduleResolver = moduleResolver;
        this.siblingModules = siblingModules;
    }

    /**
     * Parse source code into a syntax tree
     * @param source The source code to parse
     * @param moduleResolver Optional function to resolve imported modules
     * @param siblingModules Optional array of modules in the same directory (implicitly imported)
     */
    static parse(source: string, moduleResolver?: ModuleResolver, siblingModules?: Module[]): SyntaxTree {
        const scanner = new Scanner(source);
        const parser = new Parser(source);
        return new SyntaxTree(source, scanner, parser, moduleResolver, siblingModules);
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
            // Prevent infinite recursion during sibling imports
            if (this.isBinding) {
                console.log('[CCScript:SyntaxTree] Already binding, returning empty result');
                return {
                    symbols: new SymbolTable(),
                    // eslint-disable-next-line @typescript-eslint/no-require-imports -- need to fix why this is a circular dependency in the first place
                    scopes: new (require('./semantic/scope').ScopeManager)(),
                    nodeScopes: new Map(),
                    references: new Map(),
                    diagnostics: [],
                    types: new Map()
                };
            }

            this.isBinding = true;
            console.log(`[CCScript:SyntaxTree] Running semantic binding (${this.siblingModules?.length ?? 0} siblings)`);
            try {
                this.bindingCache = Binder.bind(this.getRoot(), this.moduleResolver, this.siblingModules);
                console.log('[CCScript:SyntaxTree] Binding complete');
            } finally {
                this.isBinding = false;
            }
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
     * Get the scope manager
     */
    getScopeManager(): import('./semantic/scope').ScopeManager {
        return this.getBinding().scopes;
    }

    /**
     * Clear the semantic binding cache.
     * Call this to force re-binding, useful when sibling modules change in LSP context.
     */
    invalidateBinding(): void {
        console.log('[CCScript:SyntaxTree] Invalidating binding cache');
        this.bindingCache = undefined;
        this.isBinding = false;
    }

    /**
     * Get the symbol at a specific position
     * @param position The position to query
     * @param filePath Optional file path to filter imported symbols
     */
    getSymbolAt(position: number, filePath?: string): Symbol | undefined {
        return this.getSymbolTable().getSymbolAt(position, filePath);
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
     * Get all symbols visible at a specific position.
     * Filters by scope visibility. Includes imported symbols from sibling modules.
     */
    getVisibleSymbolsAt(position: number): Symbol[] {
        const node = this.getNodeAtPosition(position);
        const scopeId = this.getBinding().nodeScopes.get(node.position);

        if (scopeId === undefined) {
            // Fallback to global scope if no scope info
            const globalScope = this.getScopeManager().getGlobalScope();
            const visibleScopes = this.getScopeManager().getVisibleScopes(globalScope);
            return this.getSymbolTable().getVisibleSymbols(visibleScopes);
        }

        const scope = this.getScopeManager().getScope(scopeId);
        if (!scope) {
            return [];
        }

        const visibleScopes = this.getScopeManager().getVisibleScopes(scope);
        return this.getSymbolTable().getVisibleSymbols(visibleScopes);
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
        if (isRedToken(node)) {
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
     * Get all import statements
     */
    getImports(): RedNode[] {
        return this.findNodesOfKind(SyntaxKind.ImportStatement);
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
