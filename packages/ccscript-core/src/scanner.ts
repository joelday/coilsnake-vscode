/**
 * Scanner (Lexer) for CCScript.
 * Converts source text into a stream of tokens with trivia (whitespace/comments).
 * 
 * Design principles:
 * - All whitespace and comments preserved as trivia attached to tokens
 * - Resilient error recovery - never stops scanning
 * - Position tracking for all tokens
 * - Efficient single-pass scanning
 */

import { SyntaxKind } from './syntax/syntaxKind';
import { GreenToken, GreenTrivia, DiagnosticSeverity, Diagnostic } from './syntax/types';

/**
 * Scanner state and methods for tokenizing CCScript source
 */
export class Scanner {
    private readonly text: string;
    private pos = 0;
    private readonly diagnostics: Diagnostic[] = [];

    constructor(text: string) {
        this.text = text;
    }

    /**
     * Get all diagnostics collected during scanning
     */
    getDiagnostics(): readonly Diagnostic[] {
        return this.diagnostics;
    }

    /**
     * Scan all tokens from the source text
     */
    scanTokens(): GreenToken[] {
        const tokens: GreenToken[] = [];

        while (this.pos < this.text.length) {
            const token = this.scanToken();
            tokens.push(token);
        }

        // Add end of file token with any trailing trivia
        const leadingTrivia = this.scanTrivia();
        const triviaWidth = leadingTrivia.reduce((sum, t) => sum + t.width, 0);
        tokens.push({
            kind: SyntaxKind.EndOfFileToken,
            text: '',
            width: triviaWidth,
            leadingTrivia: leadingTrivia.length > 0 ? leadingTrivia : undefined,
            children: [],
        });

        return tokens;
    }

    /**
     * Scan a single token with leading/trailing trivia
     */
    private scanToken(): GreenToken {
        const leadingTrivia = this.scanTrivia();
        const start = this.pos;

        if (this.pos >= this.text.length) {
            return this.createToken(SyntaxKind.EndOfFileToken, '', leadingTrivia);
        }

        const ch = this.text[this.pos];

        // Identifiers and keywords
        if (this.isIdentifierStart(ch)) {
            return this.scanIdentifierOrKeyword(leadingTrivia);
        }

        // Hex literals (check before numbers since 0x starts with digit)
        if (ch === '0' && this.pos + 1 < this.text.length &&
            (this.text[this.pos + 1] === 'x' || this.text[this.pos + 1] === 'X')) {
            return this.scanHexLiteral(leadingTrivia);
        }

        // Numbers
        if (this.isDigit(ch)) {
            return this.scanNumericLiteral(leadingTrivia);
        }

        // Strings
        if (ch === '"') {
            return this.scanStringLiteral(leadingTrivia);
        }

        // Punctuation and operators
        switch (ch) {
            case '{': return this.scanSingleChar(SyntaxKind.OpenBraceToken, leadingTrivia);
            case '}': return this.scanSingleChar(SyntaxKind.CloseBraceToken, leadingTrivia);
            case '[': return this.scanSingleChar(SyntaxKind.OpenBracketToken, leadingTrivia);
            case ']': return this.scanSingleChar(SyntaxKind.CloseBracketToken, leadingTrivia);
            case '(': return this.scanSingleChar(SyntaxKind.OpenParenToken, leadingTrivia);
            case ')': return this.scanSingleChar(SyntaxKind.CloseParenToken, leadingTrivia);
            case ':': return this.scanSingleChar(SyntaxKind.ColonToken, leadingTrivia);
            case ',': return this.scanSingleChar(SyntaxKind.CommaToken, leadingTrivia);
            case '.': return this.scanSingleChar(SyntaxKind.DotToken, leadingTrivia);
            case '|': return this.scanSingleChar(SyntaxKind.PipeToken, leadingTrivia);
            case '/': return this.scanSingleChar(SyntaxKind.SlashToken, leadingTrivia);
            case '=':
                if (this.peek(1) === '=') {
                    return this.scanMultiChar(SyntaxKind.EqualsToken, 2, leadingTrivia);
                }
                return this.scanSingleChar(SyntaxKind.EqualsToken, leadingTrivia);
            case '!':
                if (this.peek(1) === '=') {
                    return this.scanMultiChar(SyntaxKind.EqualsToken, 2, leadingTrivia);
                }
                return this.scanSingleChar(SyntaxKind.EqualsToken, leadingTrivia);
            case '<':
                if (this.peek(1) === '=') {
                    return this.scanMultiChar(SyntaxKind.EqualsToken, 2, leadingTrivia);
                }
                return this.scanSingleChar(SyntaxKind.EqualsToken, leadingTrivia);
            case '>':
                if (this.peek(1) === '=') {
                    return this.scanMultiChar(SyntaxKind.EqualsToken, 2, leadingTrivia);
                }
                return this.scanSingleChar(SyntaxKind.EqualsToken, leadingTrivia);
            case '+':
            case '-':
            case '*':
            case '%':
            case '&':
            case '^':
            case '~':
                // These will be handled by parser as operators
                return this.scanSingleChar(SyntaxKind.Identifier, leadingTrivia);
        }

        // Unknown character - create error token
        this.addDiagnostic(start, 1, DiagnosticSeverity.Error,
            `Unexpected character: '${ch}'`);
        this.pos++;
        return this.createToken(SyntaxKind.UnexpectedToken, ch, leadingTrivia);
    }

    /**
     * Scan leading trivia (whitespace and comments before a token)
     * Following Roslyn: newlines are in trailing trivia, so skip them here
     */
    private scanTrivia(): GreenTrivia[] {
        const trivia: GreenTrivia[] = [];

        while (this.pos < this.text.length) {
            const ch = this.text[this.pos];
            const start = this.pos;

            if (ch === ' ' || ch === '\t') {
                // Whitespace (indent at start of line)
                while (this.pos < this.text.length &&
                    (this.text[this.pos] === ' ' || this.text[this.pos] === '\t')) {
                    this.pos++;
                }
                const text = this.text.substring(start, this.pos);
                trivia.push({
                    kind: SyntaxKind.WhitespaceTrivia,
                    text,
                    width: text.length
                });
            } else if (ch === '\n' || ch === '\r') {
                // Skip newlines - they should have been in previous token's trailing trivia
                // But handle them gracefully if they appear (e.g., at start of file)
                if (ch === '\r' && this.peek(1) === '\n') {
                    this.pos += 2;
                    trivia.push({
                        kind: SyntaxKind.NewLineTrivia,
                        text: '\r\n',
                        width: 2
                    });
                } else {
                    this.pos++;
                    trivia.push({
                        kind: SyntaxKind.NewLineTrivia,
                        text: ch,
                        width: 1
                    });
                }
            } else if (ch === '/' && this.peek(1) === '/') {
                // Single-line comment
                this.pos += 2;
                while (this.pos < this.text.length &&
                    this.text[this.pos] !== '\n' &&
                    this.text[this.pos] !== '\r') {
                    this.pos++;
                }
                const text = this.text.substring(start, this.pos);
                trivia.push({
                    kind: SyntaxKind.SingleLineCommentTrivia,
                    text,
                    width: text.length
                });
            } else if (ch === '/' && this.peek(1) === '*') {
                // Multi-line comment
                this.pos += 2;
                while (this.pos < this.text.length - 1) {
                    if (this.text[this.pos] === '*' && this.text[this.pos + 1] === '/') {
                        this.pos += 2;
                        break;
                    }
                    this.pos++;
                }
                const text = this.text.substring(start, this.pos);
                trivia.push({
                    kind: SyntaxKind.MultiLineCommentTrivia,
                    text,
                    width: text.length
                });
                if (!text.endsWith('*/')) {
                    this.addDiagnostic(start, text.length, DiagnosticSeverity.Error,
                        'Unterminated multi-line comment');
                }
            } else {
                break;
            }
        }

        return trivia;
    }

    /**
     * Scan identifier or keyword
     */
    private scanIdentifierOrKeyword(leadingTrivia: GreenTrivia[]): GreenToken {
        const start = this.pos;

        while (this.pos < this.text.length && this.isIdentifierPart(this.text[this.pos])) {
            this.pos++;
        }

        const text = this.text.substring(start, this.pos);
        const kind = this.getKeywordKind(text);

        return this.createToken(kind, text, leadingTrivia);
    }

    /**
     * Scan numeric literal
     */
    private scanNumericLiteral(leadingTrivia: GreenTrivia[]): GreenToken {
        const start = this.pos;

        while (this.pos < this.text.length && this.isDigit(this.text[this.pos])) {
            this.pos++;
        }

        const text = this.text.substring(start, this.pos);
        return this.createToken(SyntaxKind.NumericLiteral, text, leadingTrivia);
    }

    /**
     * Scan hex literal (0xABCD)
     */
    private scanHexLiteral(leadingTrivia: GreenTrivia[]): GreenToken {
        const start = this.pos;
        this.pos += 2; // Skip '0x'

        while (this.pos < this.text.length && this.isHexDigit(this.text[this.pos])) {
            this.pos++;
        }

        const text = this.text.substring(start, this.pos);
        if (text.length === 2) {
            this.addDiagnostic(start, 2, DiagnosticSeverity.Error,
                'Hex literal must have at least one digit');
        }

        return this.createToken(SyntaxKind.HexLiteral, text, leadingTrivia);
    }

    /**
     * Scan string literal with control codes
     */
    private scanStringLiteral(leadingTrivia: GreenTrivia[]): GreenToken {
        const start = this.pos;
        this.pos++; // Skip opening quote

        while (this.pos < this.text.length) {
            const ch = this.text[this.pos];

            if (ch === '"') {
                this.pos++;
                break;
            } else if (ch === '\\') {
                this.pos += 2; // Skip escape sequence
            } else if (ch === '\n' || ch === '\r') {
                this.addDiagnostic(start, this.pos - start, DiagnosticSeverity.Error,
                    'Unterminated string literal');
                break;
            } else {
                this.pos++;
            }
        }

        const text = this.text.substring(start, this.pos);
        if (!text.endsWith('"')) {
            this.addDiagnostic(start, text.length, DiagnosticSeverity.Error,
                'Unterminated string literal');
        }

        return this.createToken(SyntaxKind.StringLiteral, text, leadingTrivia);
    }

    /**
     * Scan single character token
     */
    private scanSingleChar(kind: SyntaxKind, leadingTrivia: GreenTrivia[]): GreenToken {
        const text = this.text[this.pos];
        this.pos++;
        return this.createToken(kind, text, leadingTrivia);
    }

    /**
     * Scan multi-character token
     */
    private scanMultiChar(kind: SyntaxKind, length: number, leadingTrivia: GreenTrivia[]): GreenToken {
        const text = this.text.substring(this.pos, this.pos + length);
        this.pos += length;
        return this.createToken(kind, text, leadingTrivia);
    }

    /**
     * Create a token with trivia
     */
    private createToken(kind: SyntaxKind, text: string, leadingTrivia: GreenTrivia[]): GreenToken {
        // Scan trailing trivia (whitespace and newlines after this token, before next token)
        // Following Roslyn's pattern: newlines go in trailing trivia, comments in leading trivia
        const trailingTrivia = this.scanTrailingTrivia();
        const triviaWidth = leadingTrivia.reduce((sum, t) => sum + t.width, 0) +
            trailingTrivia.reduce((sum, t) => sum + t.width, 0);

        return {
            kind,
            text,
            width: text.length + triviaWidth,
            leadingTrivia: leadingTrivia.length > 0 ? leadingTrivia : undefined,
            trailingTrivia: trailingTrivia.length > 0 ? trailingTrivia : undefined,
            children: [],
        };
    }

    /**
     * Scan trailing trivia (whitespace and newlines after a token)
     * Following Roslyn: newlines and whitespace go in trailing trivia of previous token
     */
    private scanTrailingTrivia(): GreenTrivia[] {
        const trivia: GreenTrivia[] = [];

        while (this.pos < this.text.length) {
            const ch = this.text[this.pos];
            const start = this.pos;

            if (ch === ' ' || ch === '\t') {
                // Whitespace
                while (this.pos < this.text.length &&
                    (this.text[this.pos] === ' ' || this.text[this.pos] === '\t')) {
                    this.pos++;
                }
                const text = this.text.substring(start, this.pos);
                trivia.push({
                    kind: SyntaxKind.WhitespaceTrivia,
                    text,
                    width: text.length
                });
            } else if (ch === '\n' || ch === '\r') {
                // Newline - consume it and stop (one newline per token's trailing trivia)
                if (ch === '\r' && this.peek(1) === '\n') {
                    this.pos += 2;
                    trivia.push({
                        kind: SyntaxKind.NewLineTrivia,
                        text: '\r\n',
                        width: 2
                    });
                } else {
                    this.pos++;
                    trivia.push({
                        kind: SyntaxKind.NewLineTrivia,
                        text: ch,
                        width: 1
                    });
                }
                // Stop after first newline
                break;
            } else {
                // Not trailing trivia (comment or code), stop here
                break;
            }
        }

        return trivia;
    }

    /**
     * Get keyword kind from identifier text
     */
    private getKeywordKind(text: string): SyntaxKind {
        switch (text.toLowerCase()) {
            case 'and': return SyntaxKind.AndKeyword;
            case 'byte': return SyntaxKind.ByteKeyword;
            case 'command': return SyntaxKind.CommandKeyword;
            case 'count': return SyntaxKind.CountKeyword;
            case 'default': return SyntaxKind.DefaultKeyword;
            case 'define': return SyntaxKind.DefineKeyword;
            case 'else': return SyntaxKind.ElseKeyword;
            case 'false': return SyntaxKind.FalseKeyword;
            case 'flag': return SyntaxKind.FlagKeyword;
            case 'if': return SyntaxKind.IfKeyword;
            case 'long': return SyntaxKind.LongKeyword;
            case 'menu': return SyntaxKind.MenuKeyword;
            case 'not': return SyntaxKind.NotKeyword;
            case 'or': return SyntaxKind.OrKeyword;
            case 'rom': return SyntaxKind.ROMKeyword;
            case 'romtbl': return SyntaxKind.ROMTBLKeyword;
            case 'setcount': return SyntaxKind.SetcountKeyword;
            case 'short': return SyntaxKind.ShortKeyword;
            case 'true': return SyntaxKind.TrueKeyword;
            case 'var': return SyntaxKind.VarKeyword;
            default: return SyntaxKind.Identifier;
        }
    }

    /**
     * Check if character can start an identifier
     */
    private isIdentifierStart(ch: string): boolean {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }

    /**
     * Check if character can be part of an identifier
     */
    private isIdentifierPart(ch: string): boolean {
        return this.isIdentifierStart(ch) || this.isDigit(ch);
    }

    /**
     * Check if character is a digit
     */
    private isDigit(ch: string): boolean {
        return ch >= '0' && ch <= '9';
    }

    /**
     * Check if character is a hex digit
     */
    private isHexDigit(ch: string): boolean {
        return this.isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
    }

    /**
     * Peek ahead n characters without advancing position
     */
    private peek(n: number): string | undefined {
        const index = this.pos + n;
        return index < this.text.length ? this.text[index] : undefined;
    }

    /**
     * Add a diagnostic message
     */
    private addDiagnostic(start: number, length: number, severity: DiagnosticSeverity, message: string): void {
        this.diagnostics.push({
            span: { start, length },
            severity,
            message,
        });
    }
}
