/**
 * Binder for CCScript semantic analysis.
 * Walks the AST, builds symbol tables, and resolves identifiers.
 */

import { RedNode, RedToken } from '../redNode';
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
    private references = new Map<RedNode, Symbol>();
    private diagnostics: SemanticDiagnostic[] = [];
    private types = new Map<RedNode, Type>();

    constructor() {
        this.currentScope = this.scopes.getGlobalScope();
    }

    /**
     * Binds a syntax tree and returns the binding result.
     */
    static bind(root: RedNode): BindingResult {
        const binder = new Binder();
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
        // For diagnostics, we need the position of the actual token text, not including leading trivia
        let position = node.position;
        let length = 1;

        if (node instanceof RedToken) {
            // Calculate leading trivia width to skip past it
            const leadingTriviaWidth = node.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
            position = node.position + leadingTriviaWidth;
            length = node.text.length;
        } else {
            // For non-token nodes, find the first meaningful token
            const children = node.getChildren();
            for (const child of children) {
                if (child instanceof RedToken) {
                    const leadingTriviaWidth = child.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
                    position = child.position + leadingTriviaWidth;
                    length = child.text.length;
                    break;
                }
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
     * Records the scope for a node.
     */
    private recordNodeScope(node: RedNode): void {
        this.nodeScopes.set(node.position, this.currentScope.id);
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
            if (!this.isToken(child)) {
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
     * Binds a block statement.
     */
    private bindBlockStatement(node: RedNode): void {
        this.enterScope(ScopeKind.Block);
        this.bindChildren(node);
        this.exitScope();
    }

    /**
     * Binds a constant declaration.
     */
    private bindConstantDeclaration(node: RedNode): void {
        const nameNode = this.findChild(node, SyntaxKind.Identifier);
        if (!nameNode) {
            return;
        }

        const name = this.getTokenText(nameNode);

        // Bind the value expression first to infer type
        const valueNode = this.findChildExpression(node);
        if (valueNode) {
            this.bindNode(valueNode);
        }

        // Infer type from value
        const type = valueNode ? (this.types.get(valueNode) || Types.unknown) : Types.unknown;

        // Check for duplicate declarations in current scope
        const existing = this.symbols.lookup(name, this.currentScope.id, new Set([this.currentScope.id]));
        if (existing) {
            this.addDiagnostic(nameNode, `Constant '${name}' is already declared in this scope`);
        }

        const symbol: Symbol = {
            name,
            kind: SymbolKind.Constant,
            type,
            declaration: node,
            position: nameNode.position,
            scopeId: this.currentScope.id,
            isUsed: false,
        };

        this.symbols.add(symbol);
    }

    /**
     * Binds a command declaration.
     */
    private bindCommandDeclaration(node: RedNode): void {
        const nameNode = this.findChild(node, SyntaxKind.Identifier);
        if (!nameNode) {
            return;
        }

        const name = this.getTokenText(nameNode);

        // Create symbol for command
        const symbol: Symbol = {
            name,
            kind: SymbolKind.Command,
            type: Types.void,
            declaration: node,
            position: nameNode.position,
            scopeId: this.currentScope.id,
            isUsed: false,
            parameters: [],
        };

        this.symbols.add(symbol);

        // Enter command scope
        this.enterScope(ScopeKind.Command);

        // Bind parameters - they are stored as Identifier tokens in the node's children
        const children = node.getChildren();
        let inParamList = false;

        for (const child of children) {
            if (child.kind === SyntaxKind.OpenParenToken) {
                inParamList = true;
                continue;
            }
            if (child.kind === SyntaxKind.CloseParenToken) {
                inParamList = false;
                continue;
            }

            // Identifiers inside parens are parameters
            if (inParamList && child.kind === SyntaxKind.Identifier) {
                const paramName = this.getTokenText(child);
                const paramSymbol: Symbol = {
                    name: paramName,
                    kind: SymbolKind.Parameter,
                    type: Types.unknown, // Parameters don't have explicit types
                    declaration: child,
                    position: child.position,
                    scopeId: this.currentScope.id,
                    isUsed: false,
                };
                this.symbols.add(paramSymbol);
                symbol.parameters!.push(paramSymbol);
            }
        }

        // Bind command body
        this.bindChildren(node);

        this.exitScope();
    }

    /**
     * Binds a label declaration.
     */
    private bindLabelDeclaration(node: RedNode): void {
        const nameNode = this.findChild(node, SyntaxKind.Identifier);
        if (!nameNode) {
            return;
        }

        const name = this.getTokenText(nameNode);

        const symbol: Symbol = {
            name,
            kind: SymbolKind.Label,
            type: Types.void,
            declaration: node,
            position: nameNode.position,
            scopeId: this.currentScope.id,
            isUsed: false,
        };

        this.symbols.add(symbol);
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
        const nameToken = this.findChild(node, SyntaxKind.Identifier);
        if (!nameToken) {
            return;
        }

        const name = this.getTokenText(nameToken);

        // Resolve the identifier
        const visibleScopes = this.scopes.getVisibleScopes(this.currentScope);
        const symbol = this.symbols.lookup(name, this.currentScope.id, visibleScopes);

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
     * Binds a call expression.
     */
    private bindCallExpression(node: RedNode): void {
        // Find the target expression (IdentifierExpression or QualifiedNameExpression)
        const children = node.getChildren();
        const targetNode = children.find(c =>
            c.kind === SyntaxKind.IdentifierExpression ||
            c.kind === SyntaxKind.QualifiedNameExpression
        );

        if (targetNode) {
            // If it's an identifier expression, get the identifier name
            if (targetNode.kind === SyntaxKind.IdentifierExpression) {
                const idToken = this.findChild(targetNode, SyntaxKind.Identifier);
                if (idToken) {
                    const name = this.getTokenText(idToken);
                    const visibleScopes = this.scopes.getVisibleScopes(this.currentScope);
                    const symbol = this.symbols.lookup(name, this.currentScope.id, visibleScopes);

                    if (symbol) {
                        if (symbol.kind !== SymbolKind.Command) {
                            this.addDiagnostic(targetNode, `'${name}' is not a command`);
                        } else {
                            symbol.isUsed = true;
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

        // Bind arguments
        for (const child of children) {
            if (!this.isToken(child) && child !== targetNode) {
                this.bindNode(child);
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
        const children = node.getChildren().filter(c => !this.isToken(c));

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
        const children = node.getChildren().filter(c => !this.isToken(c));

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
     * Finds the first child of a specific kind.
     */
    private findChild(node: RedNode, kind: SyntaxKind): RedNode | undefined {
        return node.getChildren().find(c => c.kind === kind);
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

    /**
     * Checks if a node is a token.
     */
    private isToken(node: RedNode): boolean {
        return 'text' in node.green;
    }

    /**
     * Gets the text of a token node.
     */
    private getTokenText(node: RedNode): string {
        if ('text' in node.green) {
            return (node.green as { text: string }).text;
        }
        return '';
    }
}
