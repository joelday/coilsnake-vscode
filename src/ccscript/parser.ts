/**
 * Parser for CCScript.
 * Builds green syntax trees from token stream with resilient error recovery.
 * 
 * Design principles:
 * - Never abort parsing - always produce a complete tree
 * - Create error nodes for invalid syntax
 * - Synchronize at statement boundaries after errors
 * - Use operator precedence climbing for expressions
 * - All source positions preserved in green nodes
 */

import { Scanner } from './scanner';
import { SyntaxKind } from './syntax/syntaxKind';
import {
    GreenNode,
    GreenToken,
    GreenSourceFile,
    GreenStatement,
    GreenExpression,
    GreenBlockStatement,
    GreenIfStatement,
    GreenMenuStatement,
    GreenMenuOption,
    GreenLabelDeclaration,
    GreenConstantDeclaration,
    GreenCommandDeclaration,
    GreenROMWriteStatement,
    GreenROMTableWriteStatement,
    GreenErrorStatement,
    GreenIdentifierExpression,
    GreenQualifiedNameExpression,
    GreenErrorExpression,
    Diagnostic,
    DiagnosticSeverity,
} from './syntax/types';

/**
 * Parser that builds green syntax trees from tokens
 */
export class Parser {
    private readonly tokens: GreenToken[];
    private pos = 0;
    private readonly diagnostics: Diagnostic[] = [];

    constructor(source: string) {
        const scanner = new Scanner(source);
        this.tokens = scanner.scanTokens();
        this.diagnostics.push(...scanner.getDiagnostics());
    }

    /**
     * Get all diagnostics collected during parsing
     */
    getDiagnostics(): readonly Diagnostic[] {
        return this.diagnostics;
    }

    /**
     * Parse source file (entry point)
     */
    parseSourceFile(): GreenSourceFile {
        const statements: GreenStatement[] = [];

        while (!this.isAtEnd()) {
            // Skip unexpected tokens at statement level
            if (this.check(SyntaxKind.CloseBraceToken) || 
                this.check(SyntaxKind.CloseParenToken) ||
                this.check(SyntaxKind.CloseBracketToken)) {
                this.advance(); // Consume and continue
                continue;
            }

            const statement = this.parseStatement();
            if (statement) {
                statements.push(statement);
            }
        }

        const endOfFileToken = this.expectToken(SyntaxKind.EndOfFileToken);
        const children = [...statements, endOfFileToken];

        return {
            kind: SyntaxKind.SourceFile,
            width: this.calculateWidth(children),
            children,
            statements,
            endOfFileToken,
        };
    }

    // ========== Statement Parsing ==========

    /**
     * Parse a statement
     */
    private parseStatement(): GreenStatement | null {
        // Check for label (identifier followed by colon)
        if (this.check(SyntaxKind.Identifier) && this.peek(1)?.kind === SyntaxKind.ColonToken) {
            return this.parseLabelDeclaration();
        }

        // Keyword-based statements
        if (this.check(SyntaxKind.DefineKeyword)) {
            return this.parseConstantDeclaration();
        }
        if (this.check(SyntaxKind.CommandKeyword)) {
            return this.parseCommandDeclaration();
        }
        if (this.check(SyntaxKind.IfKeyword)) {
            return this.parseIfStatement();
        }
        if (this.check(SyntaxKind.MenuKeyword)) {
            return this.parseMenuStatement();
        }
        if (this.check(SyntaxKind.ROMKeyword)) {
            return this.parseROMWriteStatement();
        }
        if (this.check(SyntaxKind.ROMTBLKeyword)) {
            return this.parseROMTableWriteStatement();
        }
        if (this.check(SyntaxKind.OpenBraceToken)) {
            return this.parseBlockStatement();
        }

        // Try parsing as expression statement
        const expr = this.parseExpression();
        if (expr) {
            const children = [expr];
            return {
                kind: SyntaxKind.ExpressionStatement,
                width: this.calculateWidth(children),
                children,
                expression: expr,
            };
        }

        // Error recovery - create error node and skip token
        const errorToken = this.advance();
        this.addDiagnostic(errorToken, DiagnosticSeverity.Error,
            `Unexpected token: ${errorToken.text}`);
        
        return {
            kind: SyntaxKind.ErrorStatement,
            width: errorToken.width,
            children: [errorToken],
            errorToken,
        };
    }

    /**
     * Parse block statement
     */
    private parseBlockStatement(): GreenBlockStatement {
        const openBrace = this.expectToken(SyntaxKind.OpenBraceToken);
        const statements: GreenStatement[] = [];

        while (!this.check(SyntaxKind.CloseBraceToken) && !this.isAtEnd()) {
            const statement = this.parseStatement();
            if (statement) {
                statements.push(statement);
            }
        }

        const closeBrace = this.expectToken(SyntaxKind.CloseBraceToken);
        const children = [openBrace, ...statements, closeBrace];

        return {
            kind: SyntaxKind.BlockStatement,
            width: this.calculateWidth(children),
            children,
            openBrace,
            statements,
            closeBrace,
        };
    }

    /**
     * Parse if statement
     */
    private parseIfStatement(): GreenIfStatement {
        const ifKeyword = this.expectToken(SyntaxKind.IfKeyword);
        const condition = this.parseExpression() || this.createErrorExpression();
        const thenStatement = this.parseStatement() || this.createErrorStatement();

        let elseKeyword: GreenToken | undefined;
        let elseStatement: GreenStatement | undefined;

        if (this.check(SyntaxKind.ElseKeyword)) {
            elseKeyword = this.advance();
            elseStatement = this.parseStatement() || this.createErrorStatement();
        }

        const children = elseKeyword && elseStatement
            ? [ifKeyword, condition, thenStatement, elseKeyword, elseStatement]
            : [ifKeyword, condition, thenStatement];

        return {
            kind: SyntaxKind.IfStatement,
            width: this.calculateWidth(children),
            children,
            ifKeyword,
            condition,
            thenStatement,
            elseKeyword,
            elseStatement,
        };
    }

    /**
     * Parse menu statement
     */
    private parseMenuStatement(): GreenMenuStatement {
        const menuKeyword = this.expectToken(SyntaxKind.MenuKeyword);
        
        // Optional column count
        let columns: GreenToken | undefined;
        if (this.check(SyntaxKind.NumericLiteral)) {
            columns = this.advance();
        }

        const openBrace = this.expectToken(SyntaxKind.OpenBraceToken);
        const options: GreenMenuOption[] = [];

        while (!this.check(SyntaxKind.CloseBraceToken) && !this.isAtEnd()) {
            const option = this.parseMenuOption();
            if (option) {
                options.push(option);
            } else {
                break;
            }
        }

        const closeBrace = this.expectToken(SyntaxKind.CloseBraceToken);
        const children = columns
            ? [menuKeyword, columns, openBrace, ...options, closeBrace]
            : [menuKeyword, openBrace, ...options, closeBrace];

        return {
            kind: SyntaxKind.MenuStatement,
            width: this.calculateWidth(children),
            children,
            menuKeyword,
            columns,
            openBrace,
            options,
            closeBrace,
        };
    }

    /**
     * Parse menu option
     */
    private parseMenuOption(): GreenMenuOption | null {
        let defaultKeyword: GreenToken | undefined;
        if (this.check(SyntaxKind.DefaultKeyword)) {
            defaultKeyword = this.advance();
        }

        const label = this.parseExpression();
        if (!label) {
            return null;
        }

        const colon = this.expectToken(SyntaxKind.ColonToken);
        const statement = this.parseStatement() || this.createErrorStatement();

        const children = defaultKeyword
            ? [defaultKeyword, label, colon, statement]
            : [label, colon, statement];

        return {
            kind: SyntaxKind.MenuOption,
            width: this.calculateWidth(children),
            children,
            defaultKeyword,
            label,
            colon,
            statement,
        };
    }

    /**
     * Parse label declaration
     */
    private parseLabelDeclaration(): GreenLabelDeclaration {
        const identifier = this.expectToken(SyntaxKind.Identifier);
        const colon = this.expectToken(SyntaxKind.ColonToken);
        const children = [identifier, colon];

        return {
            kind: SyntaxKind.LabelDeclaration,
            width: this.calculateWidth(children),
            children,
            identifier,
            colon,
        };
    }

    /**
     * Parse constant declaration
     */
    private parseConstantDeclaration(): GreenConstantDeclaration {
        const defineKeyword = this.expectToken(SyntaxKind.DefineKeyword);
        const identifier = this.expectToken(SyntaxKind.Identifier);
        const equals = this.expectToken(SyntaxKind.EqualsToken);
        const value = this.parseExpression() || this.createErrorExpression();
        const children = [defineKeyword, identifier, equals, value];

        return {
            kind: SyntaxKind.ConstantDeclaration,
            width: this.calculateWidth(children),
            children,
            defineKeyword,
            identifier,
            equals,
            value,
        };
    }

    /**
     * Parse command declaration
     */
    private parseCommandDeclaration(): GreenCommandDeclaration {
        const commandKeyword = this.expectToken(SyntaxKind.CommandKeyword);
        const identifier = this.expectToken(SyntaxKind.Identifier);

        let openParen: GreenToken | undefined;
        let parameters: readonly GreenToken[] = [];
        let closeParen: GreenToken | undefined;

        if (this.check(SyntaxKind.OpenParenToken)) {
            openParen = this.advance();
            const params: GreenToken[] = [];

            while (!this.check(SyntaxKind.CloseParenToken) && !this.isAtEnd()) {
                if (this.check(SyntaxKind.Identifier)) {
                    params.push(this.advance());
                    if (this.check(SyntaxKind.CommaToken)) {
                        this.advance(); // Skip comma
                    }
                } else {
                    break;
                }
            }

            parameters = params;
            closeParen = this.expectToken(SyntaxKind.CloseParenToken);
        }

        const body = this.parseStatement() || this.createErrorStatement();
        const children = openParen && closeParen
            ? [commandKeyword, identifier, openParen, ...parameters, closeParen, body]
            : [commandKeyword, identifier, body];

        return {
            kind: SyntaxKind.CommandDeclaration,
            width: this.calculateWidth(children),
            children,
            commandKeyword,
            identifier,
            openParen,
            parameters,
            closeParen,
            body,
        };
    }

    /**
     * Parse ROM write statement
     */
    private parseROMWriteStatement(): GreenROMWriteStatement {
        const romKeyword = this.expectToken(SyntaxKind.ROMKeyword);
        const openBracket = this.expectToken(SyntaxKind.OpenBracketToken);
        const address = this.parseExpression() || this.createErrorExpression();
        const closeBracket = this.expectToken(SyntaxKind.CloseBracketToken);
        const equals = this.expectToken(SyntaxKind.EqualsToken);
        const value = this.parseExpression() || this.createErrorExpression();
        const children = [romKeyword, openBracket, address, closeBracket, equals, value];

        return {
            kind: SyntaxKind.ROMWriteStatement,
            width: this.calculateWidth(children),
            children,
            romKeyword,
            openBracket,
            address,
            closeBracket,
            equals,
            value,
        };
    }

    /**
     * Parse ROM table write statement
     */
    private parseROMTableWriteStatement(): GreenROMTableWriteStatement {
        const romtblKeyword = this.expectToken(SyntaxKind.ROMTBLKeyword);
        const openBracket = this.expectToken(SyntaxKind.OpenBracketToken);
        const base = this.parseExpression() || this.createErrorExpression();
        const comma1 = this.expectToken(SyntaxKind.CommaToken);
        const size = this.parseExpression() || this.createErrorExpression();
        const comma2 = this.expectToken(SyntaxKind.CommaToken);
        const index = this.parseExpression() || this.createErrorExpression();
        const closeBracket = this.expectToken(SyntaxKind.CloseBracketToken);
        const equals = this.expectToken(SyntaxKind.EqualsToken);
        const value = this.parseExpression() || this.createErrorExpression();
        const children = [romtblKeyword, openBracket, base, comma1, size, comma2, index, closeBracket, equals, value];

        return {
            kind: SyntaxKind.ROMTableWriteStatement,
            width: this.calculateWidth(children),
            children,
            romtblKeyword,
            openBracket,
            base,
            comma1,
            size,
            comma2,
            index,
            closeBracket,
            equals,
            value,
        };
    }

    // ========== Expression Parsing ==========

    /**
     * Parse expression (entry point for expression parsing)
     */
    private parseExpression(): GreenExpression | null {
        return this.parseBinaryExpression(0);
    }

    /**
     * Parse binary expression with operator precedence
     */
    private parseBinaryExpression(minPrecedence: number): GreenExpression | null {
        let left = this.parseUnaryExpression();
        if (!left) {
            return null;
        }

        while (true) {
            const precedence = this.getBinaryOperatorPrecedence(this.current()?.kind);
            if (precedence < minPrecedence) {
                break;
            }

            const operator = this.advance();
            const right = this.parseBinaryExpression(precedence + 1);
            if (!right) {
                this.addDiagnostic(operator, DiagnosticSeverity.Error,
                    'Expected expression after operator');
                break;
            }

            const children: GreenNode[] = [left, operator, right];
            left = {
                kind: SyntaxKind.BinaryExpression,
                width: this.calculateWidth(children),
                children,
                left,
                operator,
                right,
            };
        }

        return left;
    }

    /**
     * Parse unary expression
     */
    private parseUnaryExpression(): GreenExpression | null {
        // Check for unary operators (-, +, ~, not)
        if (this.check(SyntaxKind.NotKeyword) || 
            this.checkText('-') || 
            this.checkText('+') || 
            this.checkText('~')) {
            const operator = this.advance();
            const operand = this.parseUnaryExpression() || this.createErrorExpression();
            const children = [operator, operand];

            return {
                kind: SyntaxKind.UnaryExpression,
                width: this.calculateWidth(children),
                children,
                operator,
                operand,
            };
        }

        return this.parsePostfixExpression();
    }

    /**
     * Parse postfix expression (call, array access, qualified name)
     */
    private parsePostfixExpression(): GreenExpression | null {
        let expr = this.parsePrimaryExpression();
        if (!expr) {
            return null;
        }

        while (true) {
            // Member access (qualified name)
            if (this.check(SyntaxKind.DotToken)) {
                const dot = this.advance();
                const right = this.expectToken(SyntaxKind.Identifier);
                
                // Convert to qualified name if left is identifier
                if (expr.kind === SyntaxKind.IdentifierExpression) {
                    const children: GreenNode[] = [expr.identifier, dot, right];
                    expr = {
                        kind: SyntaxKind.QualifiedNameExpression,
                        width: this.calculateWidth(children),
                        children,
                        left: expr.identifier,
                        dot,
                        right,
                    };
                } else {
                    this.addDiagnostic(dot, DiagnosticSeverity.Error,
                        'Qualified names must start with identifier');
                    break;
                }
            }
            // Call expression
            else if (this.check(SyntaxKind.OpenParenToken)) {
                const openParen = this.advance();
                const args: GreenExpression[] = [];

                while (!this.check(SyntaxKind.CloseParenToken) && !this.isAtEnd()) {
                    const arg = this.parseExpression();
                    if (arg) {
                        args.push(arg);
                        if (this.check(SyntaxKind.CommaToken)) {
                            this.advance();
                        }
                    } else {
                        break;
                    }
                }

                const closeParen = this.expectToken(SyntaxKind.CloseParenToken);
                
                // Verify target is identifier or qualified name
                if (expr.kind !== SyntaxKind.IdentifierExpression && 
                    expr.kind !== SyntaxKind.QualifiedNameExpression) {
                    this.addDiagnostic(openParen, DiagnosticSeverity.Error,
                        'Can only call identifiers or qualified names');
                }

                const children: GreenNode[] = [expr, openParen, ...args, closeParen];
                expr = {
                    kind: SyntaxKind.CallExpression,
                    width: this.calculateWidth(children),
                    children,
                    target: expr as GreenIdentifierExpression | GreenQualifiedNameExpression,
                    openParen,
                    arguments: args,
                    closeParen,
                };
            } else {
                break;
            }
        }

        return expr;
    }

    /**
     * Parse primary expression (literals, identifiers, etc.)
     */
    private parsePrimaryExpression(): GreenExpression | null {
        // Literals
        if (this.check(SyntaxKind.NumericLiteral) || this.check(SyntaxKind.HexLiteral)) {
            const token = this.advance();
            return {
                kind: SyntaxKind.NumericLiteralExpression,
                width: token.width,
                children: [token],
                token,
            };
        }

        if (this.check(SyntaxKind.StringLiteral)) {
            const token = this.advance();
            // For now, treat as single token (template parsing would be more complex)
            return {
                kind: SyntaxKind.StringLiteralExpression,
                width: token.width,
                children: [token],
                parts: [token],
            };
        }

        if (this.check(SyntaxKind.TrueKeyword) || this.check(SyntaxKind.FalseKeyword)) {
            const token = this.advance();
            return {
                kind: SyntaxKind.BooleanLiteralExpression,
                width: token.width,
                children: [token],
                token,
            };
        }

        // Flag expression
        if (this.check(SyntaxKind.FlagKeyword)) {
            const flagKeyword = this.advance();
            const number = this.expectToken(SyntaxKind.NumericLiteral);
            const children = [flagKeyword, number];

            return {
                kind: SyntaxKind.FlagExpression,
                width: this.calculateWidth(children),
                children,
                flagKeyword,
                number,
            };
        }

        // Array access (byte, short, long)
        if (this.check(SyntaxKind.ByteKeyword) || 
            this.check(SyntaxKind.ShortKeyword) || 
            this.check(SyntaxKind.LongKeyword)) {
            const typeKeyword = this.advance();
            let openBracket: GreenToken | undefined;
            let indexValue: GreenToken | undefined;
            let closeBracket: GreenToken | undefined;

            if (this.check(SyntaxKind.OpenBracketToken)) {
                openBracket = this.advance();
                indexValue = this.expectToken(SyntaxKind.NumericLiteral);
                closeBracket = this.expectToken(SyntaxKind.CloseBracketToken);
            }

            const expression = this.parsePrimaryExpression() || this.createErrorExpression();
            const children = openBracket && indexValue && closeBracket
                ? [typeKeyword, openBracket, indexValue, closeBracket, expression]
                : [typeKeyword, expression];

            return {
                kind: SyntaxKind.ArrayAccessExpression,
                width: this.calculateWidth(children),
                children,
                typeKeyword,
                openBracket,
                indexValue,
                closeBracket,
                expression,
            };
        }

        // Identifier
        if (this.check(SyntaxKind.Identifier)) {
            const identifier = this.advance();
            return {
                kind: SyntaxKind.IdentifierExpression,
                width: identifier.width,
                children: [identifier],
                identifier,
            };
        }

        // Parenthesized expression
        if (this.check(SyntaxKind.OpenParenToken)) {
            this.advance();
            const expr = this.parseExpression();
            this.expectToken(SyntaxKind.CloseParenToken);
            return expr;
        }

        return null;
    }

    // ========== Helper Methods ==========

    /**
     * Get binary operator precedence
     */
    private getBinaryOperatorPrecedence(kind: SyntaxKind | undefined): number {
        if (!kind) return -1;

        switch (kind) {
            case SyntaxKind.OrKeyword:
                return 1;
            case SyntaxKind.AndKeyword:
                return 2;
            // Comparison operators (==, !=, <, >, <=, >=)
            case SyntaxKind.EqualsToken: {
                if (this.current()?.text === '==') return 3;
                if (this.current()?.text === '!=') return 3;
                if (this.current()?.text === '<') return 3;
                if (this.current()?.text === '>') return 3;
                if (this.current()?.text === '<=') return 3;
                if (this.current()?.text === '>=') return 3;
                return -1;
            }
            default: {
                // Arithmetic operators via text check
                const text = this.current()?.text;
                if (text === '+' || text === '-') return 4;
                if (text === '*' || text === '/' || text === '%') return 5;
                if (text === '&' || text === '|' || text === '^') return 2;
                return -1;
            }
        }
    }

    /**
     * Check if current token has specific kind
     */
    private check(kind: SyntaxKind): boolean {
        return this.current()?.kind === kind;
    }

    /**
     * Check if current token has specific text
     */
    private checkText(text: string): boolean {
        return this.current()?.text === text;
    }

    /**
     * Get current token
     */
    private current(): GreenToken | undefined {
        return this.tokens[this.pos];
    }

    /**
     * Peek ahead n tokens
     */
    private peek(n: number): GreenToken | undefined {
        return this.tokens[this.pos + n];
    }

    /**
     * Advance to next token
     */
    private advance(): GreenToken {
        const token = this.current();
        if (token && token.kind !== SyntaxKind.EndOfFileToken) {
            this.pos++;
        }
        return token || this.tokens[this.tokens.length - 1];
    }

    /**
     * Expect a specific token kind
     */
    private expectToken(kind: SyntaxKind): GreenToken {
        if (this.check(kind)) {
            return this.advance();
        }

        // Create missing token and report error
        const current = this.current();
        this.addDiagnostic(current || this.tokens[this.pos - 1], DiagnosticSeverity.Error,
            `Expected ${SyntaxKind[kind]} but found ${current?.text || 'end of file'}`);

        // Return a synthetic token
        return {
            kind: SyntaxKind.MissingToken,
            text: '',
            width: 0,
            children: [],
        };
    }

    /**
     * Check if at end of tokens
     */
    private isAtEnd(): boolean {
        return this.current()?.kind === SyntaxKind.EndOfFileToken;
    }

    /**
     * Calculate total width of children
     */
    private calculateWidth(children: readonly GreenNode[]): number {
        return children.reduce((sum, child) => sum + child.width, 0);
    }

    /**
     * Add diagnostic
     */
    private addDiagnostic(token: GreenToken, severity: DiagnosticSeverity, message: string): void {
        // Approximate position from token
        let position = 0;
        for (let i = 0; i < this.pos; i++) {
            position += this.tokens[i].width;
        }

        this.diagnostics.push({
            span: { start: position, length: token.width },
            severity,
            message,
        });
    }

    /**
     * Create error expression for recovery
     */
    private createErrorExpression(): GreenErrorExpression {
        const errorToken: GreenToken = {
            kind: SyntaxKind.MissingToken,
            text: '',
            width: 0,
            children: [],
        };

        // Add diagnostic when creating error expression
        const current = this.current();
        if (current) {
            this.addDiagnostic(current, DiagnosticSeverity.Error,
                'Expected expression');
        }

        return {
            kind: SyntaxKind.ErrorExpression,
            width: 0,
            children: [errorToken],
            errorToken,
        };
    }

    /**
     * Create error statement for recovery
     */
    private createErrorStatement(): GreenErrorStatement {
        const errorToken: GreenToken = {
            kind: SyntaxKind.MissingToken,
            text: '',
            width: 0,
            children: [],
        };

        return {
            kind: SyntaxKind.ErrorStatement,
            width: 0,
            children: [errorToken],
            errorToken,
        };
    }
}
