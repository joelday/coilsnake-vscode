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
    GreenImportStatement,
    GreenMenuStatement,
    GreenMenuOption,
    GreenLabelDeclaration,
    GreenConstantDeclaration,
    GreenVariableDeclaration,
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
            fullWidth: this.calculateWidth(children),
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
        if (this.check(SyntaxKind.ImportKeyword)) {
            return this.parseImportStatement();
        }
        if (this.check(SyntaxKind.DefineKeyword)) {
            return this.parseConstantDeclaration();
        }
        if (this.check(SyntaxKind.VarKeyword)) {
            return this.parseVariableDeclaration();
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
                fullWidth: this.calculateWidth(children),
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
            fullWidth: errorToken.fullWidth,
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
            fullWidth: this.calculateWidth(children),
            children,
            openBrace,
            statements,
            closeBrace,
        };
    }

    /**
     * Parse import statement
     * Grammar: 'import' (IDENTIFIER | STRING_LITERAL)
     * If identifier, '.ccs' is appended; if string literal, used as-is
     */
    private parseImportStatement(): GreenImportStatement {
        const importKeyword = this.expectToken(SyntaxKind.ImportKeyword);

        // Accept either identifier or string literal
        let path: GreenToken;
        if (this.check(SyntaxKind.Identifier) || this.check(SyntaxKind.StringLiteral)) {
            path = this.advance();
        } else {
            path = this.expectToken(SyntaxKind.Identifier);
        }

        const children = [importKeyword, path];

        return {
            kind: SyntaxKind.ImportStatement,
            fullWidth: this.calculateWidth(children),
            children,
            importKeyword,
            path,
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
            children,
            defineKeyword,
            identifier,
            equals,
            value,
        };
    }

    /**
     * Parse variable declaration: var name = expression
     */
    private parseVariableDeclaration(): GreenVariableDeclaration {
        const varKeyword = this.expectToken(SyntaxKind.VarKeyword);
        const identifier = this.expectToken(SyntaxKind.Identifier);
        const equals = this.expectToken(SyntaxKind.EqualsToken);
        const value = this.parseExpression() || this.createErrorExpression();
        const children = [varKeyword, identifier, equals, value];

        return {
            kind: SyntaxKind.VariableDeclaration,
            fullWidth: this.calculateWidth(children),
            children,
            varKeyword,
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
            const commas: GreenToken[] = [];

            while (!this.check(SyntaxKind.CloseParenToken) && !this.isAtEnd()) {
                if (this.check(SyntaxKind.Identifier)) {
                    params.push(this.advance());
                    if (this.check(SyntaxKind.CommaToken)) {
                        commas.push(this.advance());
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
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
            fullWidth: this.calculateWidth(children),
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
     * Note: if, menu, blocks, and array access can be expressions in CCScript
     */
    private parseExpression(): GreenExpression | null {
        // If expression (can appear anywhere an expression is expected)
        if (this.check(SyntaxKind.IfKeyword)) {
            return this.parseIfStatement();
        }

        // Menu expression (can appear anywhere an expression is expected)
        if (this.check(SyntaxKind.MenuKeyword)) {
            return this.parseMenuStatement();
        }

        // Block expression (blocks can be used as expressions)
        if (this.check(SyntaxKind.OpenBraceToken)) {
            return this.parseBlockStatement();
        }

        // Array access (byte, short, long) - can contain full expressions including calls
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

            // Parse full expression (can be calls, etc.)
            const expression = this.parseExpression() || this.createErrorExpression();
            const children = openBracket && indexValue && closeBracket
                ? [typeKeyword, openBracket, indexValue, closeBracket, expression]
                : [typeKeyword, expression];

            return {
                kind: SyntaxKind.ArrayAccessExpression,
                fullWidth: this.calculateWidth(children),
                children,
                typeKeyword,
                openBracket,
                indexValue,
                closeBracket,
                expression,
            };
        }

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
                fullWidth: this.calculateWidth(children),
                children,
                left,
                operator,
                right,
            };
        }

        return left;
    }

    /**
     * Parse unary expression (not, flag, parenthesized expressions, and other unary ops)
     */
    private parseUnaryExpression(): GreenExpression | null {
        // Parenthesized expression - must be checked BEFORE parsePostfixExpression
        // to avoid confusion with call syntax
        if (this.check(SyntaxKind.OpenParenToken)) {
            this.advance();  // consume '('
            const expr = this.parseExpression();
            this.expectToken(SyntaxKind.CloseParenToken);  // consume ')'
            return expr;
        }

        // Flag expression - parse here to avoid postfix call confusion
        if (this.check(SyntaxKind.FlagKeyword)) {
            const flagKeyword = this.advance();
            // Parse primary expression for the flag operand (can be identifier, number, etc.)
            const operand = this.parsePrimaryExpression() || this.createErrorExpression();
            const children = [flagKeyword, operand];

            return {
                kind: SyntaxKind.FlagExpression,
                fullWidth: this.calculateWidth(children),
                children,
                flagKeyword,
                operand,
            };
        }

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
                fullWidth: this.calculateWidth(children),
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
                        fullWidth: this.calculateWidth(children),
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
                const commas: GreenToken[] = [];

                while (!this.check(SyntaxKind.CloseParenToken) && !this.isAtEnd()) {
                    const arg = this.parseExpression();
                    if (arg) {
                        args.push(arg);
                        if (this.check(SyntaxKind.CommaToken)) {
                            const comma = this.advance();
                            commas.push(comma);
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

                // Build children by interleaving arguments and commas
                const argChildren: GreenNode[] = [];
                for (let i = 0; i < args.length; i++) {
                    argChildren.push(args[i]);
                    if (i < commas.length) {
                        argChildren.push(commas[i]);
                    }
                }

                const children: GreenNode[] = [expr, openParen, ...argChildren, closeParen];
                expr = {
                    kind: SyntaxKind.CallExpression,
                    fullWidth: this.calculateWidth(children),
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
        // Count expressions
        if (this.check(SyntaxKind.CountKeyword)) {
            return this.parseCountExpression();
        }

        if (this.check(SyntaxKind.SetcountKeyword)) {
            return this.parseSetcountExpression();
        }

        // Literals
        if (this.check(SyntaxKind.NumericLiteral) || this.check(SyntaxKind.HexLiteral)) {
            const token = this.advance();
            return {
                kind: SyntaxKind.NumericLiteralExpression,
                fullWidth: token.fullWidth,
                children: [token],
                token,
            };
        }

        if (this.check(SyntaxKind.StringLiteral)) {
            const token = this.advance();
            // For now, treat as single token (template parsing would be more complex)
            return {
                kind: SyntaxKind.StringLiteralExpression,
                fullWidth: token.fullWidth,
                children: [token],
                parts: [token],
            };
        }

        if (this.check(SyntaxKind.TrueKeyword) || this.check(SyntaxKind.FalseKeyword)) {
            const token = this.advance();
            return {
                kind: SyntaxKind.BooleanLiteralExpression,
                fullWidth: token.fullWidth,
                children: [token],
                token,
            };
        }

        // Identifier
        if (this.check(SyntaxKind.Identifier)) {
            const identifier = this.advance();
            return {
                kind: SyntaxKind.IdentifierExpression,
                fullWidth: identifier.fullWidth,
                children: [identifier],
                identifier,
            };
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
            fullWidth: 0,
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
     * Parse count expression: count("name"), count("name", offset), count("name", offset, multiple)
     */
    private parseCountExpression(): GreenExpression {
        const countKeyword = this.advance(); // consume 'count'
        const openParen = this.expectToken(SyntaxKind.OpenParenToken);
        const counterName = this.expectToken(SyntaxKind.StringLiteral);

        const children: GreenNode[] = [countKeyword, openParen, counterName];

        // Optional: offset parameter
        if (this.check(SyntaxKind.CommaToken)) {
            const comma1 = this.advance();
            const offset = this.expectToken(SyntaxKind.NumericLiteral);
            children.push(comma1, offset);

            // Optional: multiple parameter
            if (this.check(SyntaxKind.CommaToken)) {
                const comma2 = this.advance();
                const multiple = this.expectToken(SyntaxKind.NumericLiteral);
                children.push(comma2, multiple);
            }
        }

        const closeParen = this.expectToken(SyntaxKind.CloseParenToken);
        children.push(closeParen);

        return {
            kind: SyntaxKind.CountExpression,
            fullWidth: this.calculateWidth(children),
            children,
            countKeyword,
            counterName,
        };
    }

    /**
     * Parse setcount expression: setcount("name", value)
     * Note: value can be a negative number (unary expression)
     */
    private parseSetcountExpression(): GreenExpression {
        const setcountKeyword = this.advance(); // consume 'setcount'
        const openParen = this.expectToken(SyntaxKind.OpenParenToken);
        const counterName = this.expectToken(SyntaxKind.StringLiteral);
        const comma = this.expectToken(SyntaxKind.CommaToken);

        // Parse value as expression to handle negative numbers like -1
        const valueExpr = this.parseExpression() || this.createErrorExpression();

        const closeParen = this.expectToken(SyntaxKind.CloseParenToken);

        const children = [setcountKeyword, openParen, counterName, comma, valueExpr, closeParen];

        return {
            kind: SyntaxKind.SetcountExpression,
            fullWidth: this.calculateWidth(children),
            children,
            setcountKeyword,
            counterName,
            valueExpr,
        };
    }

    /**
     * Calculate total width of children
     */
    /**
     * Calculate total fullWidth of children.
     * In Roslyn pattern, nodes store fullWidth (including all trivia).
     */
    private calculateWidth(children: readonly GreenNode[]): number {
        return children.reduce((sum, child) => sum + child.fullWidth, 0);
    }

    /**
     * Add diagnostic
     */
    private addDiagnostic(token: GreenToken, severity: DiagnosticSeverity, message: string): void {
        // Approximate position from token - accumulate fullWidth of all previous tokens
        let position = 0;
        for (let i = 0; i < this.pos; i++) {
            position += this.tokens[i].fullWidth;
        }
        // Add leading trivia width to get to the token text
        const leadingWidth = token.leadingTrivia?.reduce((sum, t) => sum + t.width, 0) ?? 0;
        position += leadingWidth;

        this.diagnostics.push({
            span: { start: position, length: token.text.length },
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
            fullWidth: 0,
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
            fullWidth: 0,
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
            fullWidth: 0,
            children: [],
        };

        return {
            kind: SyntaxKind.ErrorStatement,
            fullWidth: 0,
            children: [errorToken],
            errorToken,
        };
    }
}
