/**
 * Binder for CCScript semantic analysis.
 * Walks the AST, builds symbol tables, and resolves identifiers.
 */

import { RedNode, RedToken, isRedToken } from '../redNode';
import { SyntaxKind } from '../syntax/syntaxKind';
import { Symbol, SymbolKind, SymbolTable } from './symbol';
import { Scope, ScopeKind, ScopeManager } from './scope';
import { Type, Types } from './types';

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
 * Context for binding - provides pre-computed symbols from the module's imports
 */
export interface BindingContext {
    /** File path for symbol IDs */
    filePath: string;
    /** Top-level declarations of the module's imports (including implicit std libs) */
    importedSymbols: SymbolTable;
    /**
     * Resolves `module.member` qualifiers to that module's top-level declarations.
     * Like the compiler, any loaded module can be referenced this way, imported or not.
     */
    resolveModule?: (moduleName: string) => SymbolTable | undefined;
}

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
    private readonly symbols: SymbolTable;
    private scopes = new ScopeManager();
    private currentScope: Scope;
    private nodeScopes = new Map<number, number>();
    private references = new Map<RedNode, Symbol>();
    private diagnostics: SemanticDiagnostic[] = [];
    private types = new Map<RedNode, Type>();
    private readonly context: BindingContext;

    private constructor(context: BindingContext) {
        this.currentScope = this.scopes.getGlobalScope();
        this.context = context;

        // See through to imported symbols without copying them; this file's own symbols win
        this.symbols = new SymbolTable([{ table: context.importedSymbols }]);
    }

    /**
     * PHASE 1: Collect declarations from a module.
     * Returns a symbol table containing only module-level declarations.
     * Used by Program to build shared symbol table for compilation groups.
     * @param root The root node to collect from
     * @param filePath Absolute path to the source file  
     */
    static collectDeclarations(root: RedNode, filePath: string): SymbolTable {
        const context: BindingContext = {
            filePath,
            importedSymbols: new SymbolTable(),
        };
        const binder = new Binder(context);
        binder.collectDeclarationsPhase(root);
        return binder.symbols;
    }

    /**
     * PHASE 2: Bind references against available symbols.
     * Takes pre-computed symbols from group and dependencies.
     * @param root The root node to bind
     * @param context Binding context with shared and imported symbols
     */
    static bindReferences(root: RedNode, context: BindingContext): BindingResult {
        const binder = new Binder(context);
        
        // Collect this module's declarations (merges with imported symbols)
        binder.collectDeclarationsPhase(root);
        
        // Bind all references
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
        const id = `${this.context.filePath}:${this.currentScope.id}:${kind}:${identifierToken.text}`;

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
            modulePath: this.context.filePath,
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

        // Check for duplicate declarations in current scope. Only this file's own declarations
        // count: like the compiler, a module's definitions silently shadow imported ones.
        if (checkDuplicates) {
            const existing = this.symbols.getOwn(symbol.name)
                .some(s => s.scopeId === this.currentScope.id);
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
     * First pass: Collect all module-level declarations.
     * This allows forward references within the same module.
     */
    private collectDeclarationsPhase(node: RedNode): void {
        switch (node.kind) {
            case SyntaxKind.SourceFile:
                // Collect all top-level declarations
                for (const child of node.getChildren()) {
                    if (!isRedToken(child)) {
                        this.collectDeclarationsPhase(child);
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
     * Just creates a Module symbol to track the import.
     * Actual symbol resolution is handled by Program.
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
        const id = `${this.context.filePath}:${this.currentScope.id}:${SymbolKind.Module}:${moduleName}`;
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
            modulePath: this.context.filePath,
        };

        this.symbols.add(moduleSymbol);
        
        // Note: Symbol resolution from the imported module is handled by Program
        // which provides importedSymbols in the BindingContext
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
            case SyntaxKind.ParenthesizedExpression: {
                this.bindChildren(node);
                const inner = node.getChildren().find(c => this.types.has(c));
                this.types.set(node, (inner && this.types.get(inner)) || Types.unknown);
                break;
            }
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

        // Like the compiler, declare a block's labels before binding its statements,
        // so they can be jumped to ahead of their definition
        for (const child of node.getChildren()) {
            if (child.kind === SyntaxKind.LabelDeclaration) {
                this.recordSymbol(child, SymbolKind.Label, Types.void);
            }
        }

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
        const symbol = this.symbols.lookup(name, [this.currentScope.id]);

        if (symbol) {
            // Module-level constant, update type
            symbol.type = type;
        } else {
            // Nested constant (in command or block), create symbol now
            this.recordSymbol(node, SymbolKind.Constant, type);
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
                    const id = `${this.context.filePath}:${this.currentScope.id}:${SymbolKind.Parameter}:${child.text}`;
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
                        modulePath: this.context.filePath,
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
     * Symbol already created during label collection phase.
     */
    private bindLabelDeclaration(_node: RedNode): void {
        // Labels were already collected before binding started
        // Nothing to do here
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

        // Mark a matching import as used
        const scopeOrder = this.scopes.getVisibleScopeIds(this.currentScope);
        const importSymbol = this.symbols.lookup(moduleName, scopeOrder, SymbolKind.Module);
        if (importSymbol) {
            importSymbol.isUsed = true;
        }

        const moduleDeclarations = this.context.resolveModule?.(moduleName);
        if (!moduleDeclarations) {
            this.addDiagnostic(node, `Unknown module '${moduleName}'`);
            this.types.set(node, Types.unknown);
            return;
        }

        // Resolve the member among that module's own top-level declarations
        const globalScopeId = this.scopes.getGlobalScope().id;
        const memberSymbol = moduleDeclarations.lookup(memberName, [globalScopeId]);

        if (memberSymbol) {
            memberSymbol.isUsed = true;
            this.references.set(node, memberSymbol);
            this.types.set(node, memberSymbol.type);
        } else {
            this.addDiagnostic(node, `'${moduleName}' has no member '${memberName}'`);
            this.types.set(node, Types.unknown);
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
                    // Prefer a command so e.g. `import "save.ccs"` doesn't shadow `save()`
                    const symbol = this.symbols.lookup(name, scopeOrder, SymbolKind.Command)
                        ?? this.symbols.lookup(name, scopeOrder);

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

            // Determine operator
            const operatorToken = node.getChildren().find(c => c.kind === SyntaxKind.AndKeyword || c.kind === SyntaxKind.OrKeyword);

            if (operatorToken) {
                // (The compiler accepts any expressions as operands, e.g. `not check_something()`)
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
                // (The compiler accepts any expression, e.g. `not check_something()`)
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
            node.kind === SyntaxKind.InsertbinExpression ||
            node.kind === SyntaxKind.IdentifierExpression ||
            node.kind === SyntaxKind.CallExpression ||
            node.kind === SyntaxKind.BinaryExpression ||
            node.kind === SyntaxKind.UnaryExpression ||
            node.kind === SyntaxKind.FlagExpression ||
            node.kind === SyntaxKind.ArrayAccessExpression ||
            node.kind === SyntaxKind.IfStatement;
    }
}
