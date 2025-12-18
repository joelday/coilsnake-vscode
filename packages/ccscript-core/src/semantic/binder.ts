/**
 * Binder for CCScript semantic analysis.
 * Walks the AST, builds symbol tables, and resolves identifiers.
 */

import { RedNode, RedToken, isRedToken } from '../redNode';
import { SyntaxKind } from '../syntax/syntaxKind';
import { Symbol, SymbolKind, SymbolTable } from './symbol';
import { Scope, ScopeKind, ScopeManager } from './scope';
import { Type, Types } from './types';
import type { Module } from '../program';

/**
 * Diagnostic message from semantic analysis.
 */
export interface SemanticDiagnostic {
    /** Position in source */
    position: number;
    /** Length of the affected span */
    length: number;
    /** Diagnostic message */
    message: string;
    /** Severity level */
    severity: 'error' | 'warning' | 'info';
}

/**
 * Function to resolve imported modules
 */
export type ModuleResolver = (moduleName: string) => Module | undefined;

/**
 * Result of binding analysis.
 */
export interface BindingResult {
    /** Symbol table containing all declarations */
    symbols: SymbolTable;
    /** Scope manager containing scope hierarchy */
    scopes: ScopeManager;
    /** Map from node position to scope ID */
    nodeScopes: Map<number, number>;
    /** Map from identifier node to resolved symbol */
    references: Map<RedNode, Symbol>;
    /** Diagnostic messages */
    diagnostics: SemanticDiagnostic[];
    /** Map from node to inferred type */
    types: Map<RedNode, Type>;
}

/**
 * Binds symbols and resolves references in a CCScript AST.
 */
export class Binder {
    private symbols = new SymbolTable();
    private scopes = new ScopeManager();
    private currentScope: Scope;
    private nodeScopes = new Map<number, number>();
    private moduleResolver?: ModuleResolver;
    private siblingModules?: Module[];
    private references = new Map<RedNode, Symbol>();
    private diagnostics: SemanticDiagnostic[] = [];
    private types = new Map<RedNode, Type>();
    private filePath: string;

    constructor(filePath: string, moduleResolver?: ModuleResolver, siblingModules?: Module[]) {
        this.currentScope = this.scopes.getGlobalScope();
        this.moduleResolver = moduleResolver;
        this.siblingModules = siblingModules;
        this.filePath = filePath;
    }

    /**
     * Binds a syntax tree and returns the binding result.
     * Uses two-pass binding to support forward references:
     * - Pass 1: Collect all module-level declarations (and import sibling modules)
     * - Pass 2: Bind references and expressions
     * @param root The root node to bind
     * @param filePath Absolute path to the source file
     * @param moduleResolver Optional function to resolve imported modules
     * @param siblingModules Optional array of modules in same directory (implicitly imported)
     */
    static bind(root: RedNode, filePath: string, moduleResolver?: ModuleResolver, siblingModules?: Module[]): BindingResult {
        const binder = new Binder(filePath, moduleResolver, siblingModules);

        // Pass 1: Collect all module-level declarations (enables forward references)
        binder.collectDeclarations(root);

        // Pass 2: Import sibling modules (after collecting our own declarations to avoid conflicts)
        binder.importSiblingModules();

        // Pass 3: Bind all references and expressions
        binder.bindNode(root);

        return {
            symbols: binder.symbols,
            scopes: binder.scopes,
            nodeScopes: binder.nodeScopes,
            references: binder.references,
            diagnostics: binder.diagnostics,
            types: binder.types,
        };
    }

    /**
     * Adds a diagnostic message.
     */
    private addDiagnostic(node: RedNode, message: string, severity: 'error' | 'warning' | 'info' = 'error'): void {
        let position: number;
        let length: number;

        if (node instanceof RedToken) {
            // Token: use its span (excludes trivia)
            const span = node.span;
            position = span.start;
            length = span.length;
        } else {
            // Try to get identifier token for better diagnostic positioning
            const identifierToken = node.getIdentifierToken();
            if (identifierToken) {
                const span = identifierToken.span;
                position = span.start;
                length = span.length;
            } else {
                // Fallback: use node's span
                const span = node.span;
                position = span.start;
                length = Math.max(1, span.length);
            }
        }

        this.diagnostics.push({
            position,
            length,
            message,
            severity,
        });
    }

    /**
     * Creates a symbol from a declaration node.
     * Extracts the identifier token and uses it for authoritative positioning.
     */
    private createSymbol(node: RedNode, kind: SymbolKind, type: Type, parameters?: Symbol[]): Symbol | null {
        const identifierToken = node.getIdentifierToken();
        if (!identifierToken) {
            this.addDiagnostic(node, `${kind} declaration missing identifier`);
            return null;
        }

        const span = identifierToken.span;
        // Generate unique ID: filePath:scopeId:kind:name
        const id = `${this.filePath}:${this.currentScope.id}:${kind}:${identifierToken.text}`;

        return {
            id,
            name: identifierToken.text,
            kind,
            type,
            declaration: node,
            identifierNode: identifierToken,
            position: span.start,
            length: span.length,
            scopeId: this.currentScope.id,
            isUsed: false,
            parameters,
        };
    }

    /**
     * Helper to record symbol with duplicate checking.
     * Returns the created symbol or null if there was an error.
     */
    private recordSymbol(node: RedNode, kind: SymbolKind, type: Type, parameters?: Symbol[], checkDuplicates = true): Symbol | null {
        const symbol = this.createSymbol(node, kind, type, parameters);
        if (!symbol) {
            return null;
        }

        // Check for duplicate declarations in current scope
        if (checkDuplicates) {
            const existing = this.symbols.lookup(symbol.name, [this.currentScope.id]);
            if (existing) {
                this.addDiagnostic(node, `Duplicate declaration of '${symbol.name}'`);
                return null;
            }
        }

        this.symbols.add(symbol);
        return symbol;
    }

    /**
     * Records the scope for a node.
     */
    private recordNodeScope(node: RedNode): void {
        this.nodeScopes.set(node.position, this.currentScope.id);
    }

    /**
     * Import symbols from sibling modules (files in same directory).
     * In CCScript, files compiled together can reference each other without explicit imports.
     * Called after collectDeclarations() so local symbols take precedence.
     */
    private importSiblingModules(): void {
        console.log('[CCScript:Binder] Pass 2: Importing sibling modules');
        if (!this.siblingModules || this.siblingModules.length === 0) {
            console.log('[CCScript:Binder]   No siblings to import');
            return;
        }

        console.log(`[CCScript:Binder]   Found ${this.siblingModules.length} sibling(s)`);

        // Track imported symbol names to prevent duplicates
        const importedNames = new Set<string>();

        // Track symbols already declared in this file (don't import conflicts)
        const localSymbols = new Set<string>();
        for (const symbol of this.symbols.getAllSymbols()) {
            if (symbol.scopeId === this.currentScope.id) {
                localSymbols.add(symbol.name);
            }
        }

        for (const siblingModule of this.siblingModules) {
            console.log(`[CCScript:Binder]   Importing from: ${siblingModule.name}`);
            // Import all module-level symbols from the sibling
            const siblingSymbols = siblingModule.tree.getSymbolTable();
            const siblingScopes = siblingModule.tree.getScopeManager();

            let importedCount = 0;
            for (const symbol of siblingSymbols.getAllSymbols()) {
                // Only import module-level declarations (skip nested scopes)
                // Skip Module and Parameter symbols
                if (symbol.kind === SymbolKind.Module || symbol.kind === SymbolKind.Parameter) {
                    continue;
                }

                const symbolScope = siblingScopes.getScope(symbol.scopeId);
                if (symbolScope?.kind !== ScopeKind.Global) {
                    continue;
                }

                // Skip if already declared locally (don't override local declarations)
                if (localSymbols.has(symbol.name)) {
                    continue;
                }

                // Skip if already imported (prevents exponential duplication)
                if (importedNames.has(symbol.name)) {
                    continue;
                }

                // Create an imported symbol in the current scope with module path tracking
                // Keep the original symbol's ID so references can be matched across files
                const importedSymbol: Symbol = {
                    ...symbol,
                    scopeId: this.currentScope.id,
                    isUsed: false, // Reset usage tracking
                    modulePath: siblingModule.filePath, // Track source module
                    // id remains the same as the original symbol for cross-file matching
                };

                this.symbols.add(importedSymbol);
                importedNames.add(symbol.name);
                importedCount++;
            }
            console.log(`[CCScript:Binder]     Imported ${importedCount} symbol(s)`);
        }
        console.log('[CCScript:Binder]   Sibling import complete');
    }

    /**
     * First pass: Collect all module-level declarations.
     * This allows forward references within the same module.
     */
    private collectDeclarations(node: RedNode): void {
        switch (node.kind) {
            case SyntaxKind.SourceFile:
                // Collect all top-level declarations
                for (const child of node.getChildren()) {
                    if (!isRedToken(child)) {
                        this.collectDeclarations(child);
                    }
                }
                break;

            case SyntaxKind.ImportStatement:
                this.collectImportDeclaration(node);
                break;

            case SyntaxKind.ConstantDeclaration:
                // Only collect at module level (global scope)
                if (this.currentScope.kind === ScopeKind.Global) {
                    this.collectConstantDeclaration(node);
                }
                break;

            case SyntaxKind.CommandDeclaration:
                this.collectCommandDeclaration(node);
                break;

            case SyntaxKind.LabelDeclaration:
                this.collectLabelDeclaration(node);
                break;

            // Don't descend into blocks - only module-level declarations
            default:
                break;
        }
    }

    /**
     * Collect import declaration (pass 1)
     * Resolves the module and imports all its symbols into current scope.
     */
    private collectImportDeclaration(node: RedNode): void {
        const pathNode = node.findChildByKind(SyntaxKind.Identifier) || node.findChildByKind(SyntaxKind.StringLiteral);
        if (!pathNode || !isRedToken(pathNode)) {
            this.addDiagnostic(node, 'Import declaration missing module path');
            return;
        }

        let moduleName = pathNode.text;

        // Remove quotes from string literals
        if (pathNode.kind === SyntaxKind.StringLiteral) {
            moduleName = moduleName.slice(1, -1);
        }

        // Remove .ccs extension if present
        if (moduleName.endsWith('.ccs')) {
            moduleName = moduleName.slice(0, -4);
        }

        // Create a module symbol to track the import
        const span = pathNode.span;
        const id = `${this.filePath}:${this.currentScope.id}:${SymbolKind.Module}:${moduleName}`;
        const moduleSymbol: Symbol = {
            id,
            name: moduleName,
            kind: SymbolKind.Module,
            type: Types.unknown,
            declaration: node,
            identifierNode: pathNode,
            position: span.start,
            length: span.length,
            scopeId: this.currentScope.id,
            isUsed: false,
        };

        this.symbols.add(moduleSymbol);

        // If we have a module resolver, import symbols from the module
        if (this.moduleResolver) {
            const importedModule = this.moduleResolver(moduleName);

            if (!importedModule) {
                this.addDiagnostic(pathNode, `Cannot resolve module '${moduleName}'`, 'error');
                return;
            }

            // Get the imported module's symbols
            const importedSymbols = importedModule.tree.getSymbolTable();
            const importedScopes = importedModule.tree.getScopeManager();

            // Import all module-level symbols (constants, commands, labels)
            // Exclude Module symbols (transitive imports) and Parameters (internal to commands)
            for (const symbol of importedSymbols.getAllSymbols()) {
                // Only import module-level declarations
                if (symbol.kind === SymbolKind.Module || symbol.kind === SymbolKind.Parameter) {
                    continue;
                }

                // Check if symbol is at module level (global scope)
                const symbolScope = importedScopes.getScope(symbol.scopeId);
                if (symbolScope?.kind !== ScopeKind.Global) {
                    continue;
                }

                // Create an imported symbol in the current scope
                // We keep the original declaration but set scopeId to current scope
                const importedSymbol: Symbol = {
                    ...symbol,
                    scopeId: this.currentScope.id,
                    isUsed: false, // Reset usage tracking
                };

                this.symbols.add(importedSymbol);
            }
        }
    }

    /**
     * Collect constant declaration (pass 1)
     */
    private collectConstantDeclaration(node: RedNode): void {
        this.recordSymbol(node, SymbolKind.Constant, Types.unknown);
    }

    /**
     * Collect command declaration (pass 1)
     */
    private collectCommandDeclaration(node: RedNode): void {
        // Count parameters for the symbol
        const parameterList = node.findChildByKind(SyntaxKind.ParameterList);
        const paramCount = parameterList
            ? parameterList.getChildren().filter(c => c.kind === SyntaxKind.Identifier).length
            : 0;

        // Create placeholder parameter array for pass 1 (will be filled in pass 2)
        const parameters: Symbol[] = new Array(paramCount);

        this.recordSymbol(node, SymbolKind.Command, Types.void, parameters, false);
    }

    /**
     * Collect label declaration (pass 1)
     */
    private collectLabelDeclaration(node: RedNode): void {
        this.recordSymbol(node, SymbolKind.Label, Types.void);
    }

    /**
     * Enters a new scope.
     */
    private enterScope(kind: ScopeKind): Scope {
        const newScope = this.scopes.createChildScope(kind, this.currentScope);
        this.currentScope = newScope;
        return newScope;
    }

    /**
     * Exits the current scope.
     */
    private exitScope(): void {
        if (this.currentScope.parent) {
            this.currentScope = this.currentScope.parent;
        }
    }

    /**
     * Binds a node and its children.
     */
    private bindNode(node: RedNode): void {
        this.recordNodeScope(node);

        switch (node.kind) {
            case SyntaxKind.SourceFile:
                this.bindSourceFile(node);
                break;
            case SyntaxKind.BlockStatement:
                this.bindBlockStatement(node);
                break;
            case SyntaxKind.ImportStatement:
                this.bindImportStatement(node);
                break;
            case SyntaxKind.ConstantDeclaration:
                this.bindConstantDeclaration(node);
                break;
            case SyntaxKind.CommandDeclaration:
                this.bindCommandDeclaration(node);
                break;
            case SyntaxKind.LabelDeclaration:
                this.bindLabelDeclaration(node);
                break;
            case SyntaxKind.IfStatement:
                this.bindIfStatement(node);
                break;
            case SyntaxKind.IdentifierExpression:
                this.bindIdentifierExpression(node);
                break;
            case SyntaxKind.QualifiedNameExpression:
                this.bindQualifiedNameExpression(node);
                break;
            case SyntaxKind.CallExpression:
                this.bindCallExpression(node);
                break;
            case SyntaxKind.NumericLiteralExpression:
                this.bindNumericLiteralExpression(node);
                break;
            case SyntaxKind.StringLiteralExpression:
                this.bindStringLiteralExpression(node);
                break;
            case SyntaxKind.FlagExpression:
                this.bindFlagExpression(node);
                break;
            case SyntaxKind.BinaryExpression:
                this.bindBinaryExpression(node);
                break;
            case SyntaxKind.UnaryExpression:
                this.bindUnaryExpression(node);
                break;
            case SyntaxKind.ArrayAccessExpression:
                this.bindArrayAccessExpression(node);
                break;
            default:
                // For other nodes, just bind children
                this.bindChildren(node);
                break;
        }
    }

    /**
     * Binds all children of a node.
     */
    private bindChildren(node: RedNode): void {
        for (const child of node.getChildren()) {
            if (!isRedToken(child)) {
                this.bindNode(child);
            }
        }
    }

    /**
     * Binds a source file.
     */
    private bindSourceFile(node: RedNode): void {
        this.bindChildren(node);
    }

    /**
     * Binds an import statement (pass 2).
     * Symbol already created in pass 1, nothing to do here.
     */
    private bindImportStatement(_node: RedNode): void {
        // Import symbols already created in pass 1
    }

    /**
     * Binds a block statement.
     */
    private bindBlockStatement(node: RedNode): void {
        this.enterScope(ScopeKind.Block);
        this.bindChildren(node);
        this.exitScope();
    }

    /**
     * Binds a constant declaration (pass 2).
     * For module-level: Symbol exists from pass 1, just infer and update type.
     * For nested: Create symbol now (wasn't in pass 1).
     */
    private bindConstantDeclaration(node: RedNode): void {
        const name = node.getIdentifierName();
        if (!name) {
            return;
        }

        // Bind the value expression to infer type
        const valueNode = this.findChildExpression(node);
        if (valueNode) {
            this.bindNode(valueNode);
        }

        const type = valueNode ? (this.types.get(valueNode) || Types.unknown) : Types.unknown;

        // Check if symbol already exists from pass 1 (module-level)
        let symbol = this.symbols.lookup(name, [this.currentScope.id]);

        if (symbol) {
            // Module-level constant, update type
            symbol.type = type;
        } else {
            // Nested constant (in command or block), create symbol now
            const newSymbol = this.recordSymbol(node, SymbolKind.Constant, type);
            if (newSymbol) {
                symbol = newSymbol;
            }
        }
    }

    /**
     * Binds a command declaration (pass 2).
     * Symbol already exists from pass 1, now bind parameters and body.
     */
    private bindCommandDeclaration(node: RedNode): void {
        const name = node.getIdentifierName();
        if (!name) {
            return;
        }

        // Get the existing symbol from pass 1
        const symbol = this.symbols.lookup(name, [this.currentScope.id]);
        if (!symbol) {
            return;
        }

        // Enter command scope
        this.enterScope(ScopeKind.Command);

        // Clear placeholder parameters from pass 1 and populate with actual symbols
        symbol.parameters = [];

        // Bind parameters - they are stored in a ParameterList node
        const parameterList = node.findChildByKind(SyntaxKind.ParameterList);
        if (parameterList) {
            // Get the parameter tokens from the ParameterList's children
            const paramChildren = parameterList.getChildren();
            for (const child of paramChildren) {
                if (child.kind === SyntaxKind.Identifier && isRedToken(child)) {
                    // Create parameter symbol using helper
                    // Note: parameters are special - they're simple identifiers not declaration nodes
                    const span = child.span;
                    const id = `${this.filePath}:${this.currentScope.id}:${SymbolKind.Parameter}:${child.text}`;
                    const paramSymbol: Symbol = {
                        id,
                        name: child.text,
                        kind: SymbolKind.Parameter,
                        type: Types.unknown, // Parameters don't have explicit types
                        declaration: child,
                        identifierNode: child,
                        position: span.start,
                        length: span.length,
                        scopeId: this.currentScope.id,
                        isUsed: false,
                    };
                    this.symbols.add(paramSymbol);
                    symbol.parameters!.push(paramSymbol);
                }
            }
        }

        // Bind command body
        this.bindChildren(node);

        this.exitScope();
    }

    /**
     * Binds a label declaration (pass 2).
     * Symbol already created in pass 1, nothing to do here.
     */
    private bindLabelDeclaration(node: RedNode): void {
        // Labels can be in any scope (global, command, or block)
        // Only module-level labels were collected in pass 1, so we need to handle nested ones here
        const name = node.getIdentifierName();
        if (!name) {
            return;
        }

        // Check if this label was already collected in pass 1 (module-level)
        const existing = this.symbols.lookup(name, [this.currentScope.id]);
        if (existing && existing.declaration === node) {
            // Already collected in pass 1, nothing to do
            return;
        }

        // This is a nested label (inside a command or block), create it now
        this.recordSymbol(node, SymbolKind.Label, Types.void, [], false);
    }

    /**
     * Binds an if statement.
     */
    private bindIfStatement(node: RedNode): void {
        // Bind condition, then branch, else branch
        this.bindChildren(node);
    }

    /**
     * Binds an identifier expression (reference).
     */
    private bindIdentifierExpression(node: RedNode): void {
        const name = node.getIdentifierName();
        if (!name) {
            return;
        }

        // Resolve the identifier (search from innermost to outermost scope)
        const scopeOrder = this.scopes.getVisibleScopeIds(this.currentScope);
        const symbol = this.symbols.lookup(name, scopeOrder);

        if (symbol) {
            this.references.set(node, symbol);
            symbol.isUsed = true;
            this.types.set(node, symbol.type);
        } else {
            this.addDiagnostic(node, `Undefined identifier '${name}'`);
            this.types.set(node, Types.unknown);
        }
    }

    /**
     * Binds a qualified name expression (module.member).
     */
    private bindQualifiedNameExpression(node: RedNode): void {
        // For qualified names like std.print, we need to:
        // 1. Check if the left part (std) is a known module
        // 2. Resolve the right part (print) in that module's scope

        const children = node.getChildren();
        const leftToken = children.find(c => c.kind === SyntaxKind.Identifier);
        const rightToken = children.filter(c => c.kind === SyntaxKind.Identifier)[1];

        if (!leftToken || !rightToken) {
            // Malformed qualified name
            this.types.set(node, Types.unknown);
            return;
        }

        const moduleName = isRedToken(leftToken) ? leftToken.text : '';
        const memberName = isRedToken(rightToken) ? rightToken.text : '';

        // Check if module exists (search from innermost to outermost scope)
        const scopeOrder = this.scopes.getVisibleScopeIds(this.currentScope);
        const moduleSymbol = this.symbols.lookup(moduleName, scopeOrder);

        if (!moduleSymbol) {
            this.addDiagnostic(node, `Unknown module '${moduleName}'`);
            this.types.set(node, Types.unknown);
            return;
        }

        if (moduleSymbol.kind !== SymbolKind.Module) {
            this.addDiagnostic(node, `'${moduleName}' is not a module`);
            this.types.set(node, Types.unknown);
            return;
        }

        moduleSymbol.isUsed = true;

        // Resolve the member in the module
        if (this.moduleResolver) {
            const module = this.moduleResolver(moduleName);
            if (module) {
                // Get the symbol table from the module
                const moduleSymbols = module.tree.getSymbolTable();
                const moduleScopes = module.tree.getScopeManager();
                const globalScope = moduleScopes.getGlobalScope();
                const globalScopeOrder = moduleScopes.getVisibleScopeIds(globalScope);

                // Look up the member in the module's global scope
                const memberSymbol = moduleSymbols.lookup(memberName, globalScopeOrder);

                if (memberSymbol) {
                    // Found the symbol - set up reference and type
                    memberSymbol.isUsed = true;
                    this.references.set(node, memberSymbol);
                    this.types.set(node, memberSymbol.type);
                } else {
                    this.addDiagnostic(node, `'${moduleName}' has no member '${memberName}'`);
                    this.types.set(node, Types.unknown);
                }
            } else {
                // Module resolver couldn't find the module
                this.addDiagnostic(node, `Cannot resolve module '${moduleName}'`);
                this.types.set(node, Types.unknown);
            }
        } else {
            // No module resolver - just assume it's valid (for backwards compatibility with tests)
            this.types.set(node, Types.void);
        }
    }

    /**
     * Binds a call expression.
     */
    private bindCallExpression(node: RedNode): void {
        // Find the target expression (IdentifierExpression or QualifiedNameExpression)
        const children = node.getChildren();

        const targetNode = children.find(c =>
            c.kind === SyntaxKind.IdentifierExpression ||
            c.kind === SyntaxKind.QualifiedNameExpression
        );

        let commandSymbol: Symbol | undefined;

        if (targetNode) {
            // If it's an identifier expression, get the identifier name
            if (targetNode.kind === SyntaxKind.IdentifierExpression) {
                const name = targetNode.getIdentifierName();
                if (name) {
                    const scopeOrder = this.scopes.getVisibleScopeIds(this.currentScope);
                    const symbol = this.symbols.lookup(name, scopeOrder);

                    if (symbol) {
                        if (symbol.kind !== SymbolKind.Command) {
                            this.addDiagnostic(targetNode, `'${name}' is not a command`);
                        } else {
                            symbol.isUsed = true;
                            commandSymbol = symbol;
                        }
                        this.types.set(node, symbol.type);
                        this.references.set(targetNode, symbol);
                    } else {
                        this.addDiagnostic(targetNode, `Undefined command '${name}'`);
                        this.types.set(node, Types.unknown);
                    }
                }
            } else {
                // QualifiedNameExpression - just bind it normally
                this.bindNode(targetNode);
                this.types.set(node, this.types.get(targetNode) || Types.unknown);
            }
        }

        // Find the argument list
        const argumentList = children.find(c => c.kind === SyntaxKind.ArgumentList);
        let argumentNodes: RedNode[] = [];

        if (argumentList) {
            // Get the actual argument expressions from the ArgumentList node
            const argListChildren = argumentList.getChildren();
            argumentNodes = argListChildren.filter(c =>
                !isRedToken(c) &&
                c.kind !== SyntaxKind.OpenParenToken &&
                c.kind !== SyntaxKind.CloseParenToken &&
                c.kind !== SyntaxKind.CommaToken
            );

            // Bind all arguments
            for (const arg of argumentNodes) {
                this.bindNode(arg);
            }
        }

        // Validate argument count
        if (commandSymbol && commandSymbol.parameters) {
            const expectedCount = commandSymbol.parameters.length;
            const actualCount = argumentNodes.length;

            if (actualCount < expectedCount) {
                this.addDiagnostic(node, `Too few arguments to command '${commandSymbol.name}': expected ${expectedCount}, got ${actualCount}`);
            } else if (actualCount > expectedCount) {
                this.addDiagnostic(node, `Too many arguments to command '${commandSymbol.name}': expected ${expectedCount}, got ${actualCount}`);
            }
        }

        // Call expressions return void by default
        if (!this.types.has(node)) {
            this.types.set(node, Types.void);
        }
    }

    /**
     * Binds a numeric literal expression.
     */
    private bindNumericLiteralExpression(node: RedNode): void {
        this.types.set(node, Types.numericLiteral);
    }

    /**
     * Binds a string literal expression.
     */
    private bindStringLiteralExpression(node: RedNode): void {
        this.types.set(node, Types.string);
    }

    /**
     * Binds a flag expression.
     */
    private bindFlagExpression(node: RedNode): void {
        // Bind the operand
        this.bindChildren(node);

        // Flag expressions return flag type
        this.types.set(node, Types.flag);
    }

    /**
     * Binds a binary expression.
     */
    private bindBinaryExpression(node: RedNode): void {
        const children = node.getChildren().filter(c => !isRedToken(c));

        if (children.length >= 2) {
            const left = children[0];
            const right = children[1];

            this.bindNode(left);
            this.bindNode(right);

            const leftType = this.types.get(left) || Types.unknown;
            const rightType = this.types.get(right) || Types.unknown;

            // Determine operator
            const operatorToken = node.getChildren().find(c => c.kind === SyntaxKind.AndKeyword || c.kind === SyntaxKind.OrKeyword);

            if (operatorToken) {
                // For boolean operators, operands should be flags
                if (leftType.kind !== Types.flag.kind && leftType.kind !== Types.unknown.kind) {
                    this.addDiagnostic(left, `Expected flag type, got ${leftType.name}`);
                }
                if (rightType.kind !== Types.flag.kind && rightType.kind !== Types.unknown.kind) {
                    this.addDiagnostic(right, `Expected flag type, got ${rightType.name}`);
                }

                this.types.set(node, Types.flag);
            } else {
                this.types.set(node, Types.unknown);
            }
        }
    }

    /**
     * Binds a unary expression.
     */
    private bindUnaryExpression(node: RedNode): void {
        const children = node.getChildren().filter(c => !isRedToken(c));

        if (children.length > 0) {
            const operand = children[0];
            this.bindNode(operand);

            const operandType = this.types.get(operand) || Types.unknown;

            // Check for 'not' operator
            const notToken = node.getChildren().find(c => c.kind === SyntaxKind.NotKeyword);
            if (notToken) {
                // not operator requires flag type
                if (operandType.kind !== Types.flag.kind && operandType.kind !== Types.unknown.kind) {
                    this.addDiagnostic(operand, `Expected flag type, got ${operandType.name}`);
                }
                this.types.set(node, Types.flag);
            } else {
                this.types.set(node, operandType);
            }
        }
    }

    /**
     * Binds an array access expression.
     */
    private bindArrayAccessExpression(node: RedNode): void {
        this.bindChildren(node);

        // Determine type from size specifier
        const children = node.getChildren();
        const byteToken = children.find(c => c.kind === SyntaxKind.ByteKeyword);
        const shortToken = children.find(c => c.kind === SyntaxKind.ShortKeyword);
        const longToken = children.find(c => c.kind === SyntaxKind.LongKeyword);

        if (byteToken) {
            this.types.set(node, Types.byte);
        } else if (shortToken) {
            this.types.set(node, Types.short);
        } else if (longToken) {
            this.types.set(node, Types.long);
        } else {
            this.types.set(node, Types.unknown);
        }
    }

    /**
     * Finds the first child that is an expression.
     */
    private findChildExpression(node: RedNode): RedNode | undefined {
        return node.getChildren().find(c => this.isExpression(c));
    }

    /**
     * Checks if a node is an expression.
     */
    private isExpression(node: RedNode): boolean {
        return node.kind === SyntaxKind.NumericLiteralExpression ||
            node.kind === SyntaxKind.StringLiteralExpression ||
            node.kind === SyntaxKind.BooleanLiteralExpression ||
            node.kind === SyntaxKind.IdentifierExpression ||
            node.kind === SyntaxKind.CallExpression ||
            node.kind === SyntaxKind.BinaryExpression ||
            node.kind === SyntaxKind.UnaryExpression ||
            node.kind === SyntaxKind.FlagExpression ||
            node.kind === SyntaxKind.ArrayAccessExpression ||
            node.kind === SyntaxKind.IfStatement;
    }
}
