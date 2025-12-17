import { Scanner } from './scanner';
import { SyntaxKind } from './syntax/syntaxKind';
import { DiagnosticSeverity } from './syntax/types';

describe('Scanner', () => {
    describe('Basic tokenization', () => {
        it('should scan end of file token from empty string', () => {
            const scanner = new Scanner('');
            const tokens = scanner.scanTokens();

            expect(tokens.length).toBe(1);
            expect(tokens[0].kind).toBe(SyntaxKind.EndOfFileToken);
            expect(tokens[0].text).toBe('');
        });

        it('should scan identifier', () => {
            const scanner = new Scanner('hello');
            const tokens = scanner.scanTokens();

            expect(tokens.length).toBe(2);
            expect(tokens[0].kind).toBe(SyntaxKind.Identifier);
            expect(tokens[0].text).toBe('hello');
            expect(tokens[1].kind).toBe(SyntaxKind.EndOfFileToken);
        });

        it('should scan multiple identifiers', () => {
            const scanner = new Scanner('foo bar baz');
            const tokens = scanner.scanTokens();

            expect(tokens.length).toBe(4);
            expect(tokens[0].text).toBe('foo');
            expect(tokens[1].text).toBe('bar');
            expect(tokens[2].text).toBe('baz');
        });
    });

    describe('Keywords', () => {
        const keywords = [
            ['and', SyntaxKind.AndKeyword],
            ['byte', SyntaxKind.ByteKeyword],
            ['command', SyntaxKind.CommandKeyword],
            ['default', SyntaxKind.DefaultKeyword],
            ['define', SyntaxKind.DefineKeyword],
            ['else', SyntaxKind.ElseKeyword],
            ['flag', SyntaxKind.FlagKeyword],
            ['if', SyntaxKind.IfKeyword],
            ['import', SyntaxKind.ImportKeyword],
            ['long', SyntaxKind.LongKeyword],
            ['menu', SyntaxKind.MenuKeyword],
            ['not', SyntaxKind.NotKeyword],
            ['or', SyntaxKind.OrKeyword],
            ['rom', SyntaxKind.ROMKeyword],
            ['romtbl', SyntaxKind.ROMTBLKeyword],
            ['short', SyntaxKind.ShortKeyword],
            ['true', SyntaxKind.TrueKeyword],
            ['false', SyntaxKind.FalseKeyword],
        ];

        keywords.forEach(([text, kind]) => {
            it(`should recognize '${text}' as keyword`, () => {
                const scanner = new Scanner(text as string);
                const tokens = scanner.scanTokens();
                expect(tokens[0].kind).toBe(kind);
                expect(tokens[0].text).toBe(text);
            });

            it(`should recognize '${text}' in uppercase`, () => {
                const scanner = new Scanner((text as string).toUpperCase());
                const tokens = scanner.scanTokens();
                expect(tokens[0].kind).toBe(kind);
            });
        });
    });

    describe('Literals', () => {
        it('should scan numeric literal', () => {
            const scanner = new Scanner('42');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.NumericLiteral);
            expect(tokens[0].text).toBe('42');
        });

        it('should scan multiple numeric literals', () => {
            const scanner = new Scanner('123 456 789');
            const tokens = scanner.scanTokens();

            expect(tokens[0].text).toBe('123');
            expect(tokens[1].text).toBe('456');
            expect(tokens[2].text).toBe('789');
        });

        it('should scan hex literal', () => {
            const scanner = new Scanner('0xFF');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.HexLiteral);
            expect(tokens[0].text).toBe('0xFF');
        });

        it('should scan hex literal with lowercase x', () => {
            const scanner = new Scanner('0x1a2b');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.HexLiteral);
            expect(tokens[0].text).toBe('0x1a2b');
        });

        it('should report error for hex literal without digits', () => {
            const scanner = new Scanner('0x');
            const tokens = scanner.scanTokens();
            const diagnostics = scanner.getDiagnostics();

            expect(tokens[0].kind).toBe(SyntaxKind.HexLiteral);
            expect(diagnostics.length).toBe(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
        });

        it('should scan string literal', () => {
            const scanner = new Scanner('"hello world"');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.StringLiteral);
            expect(tokens[0].text).toBe('"hello world"');
        });

        it('should scan string with escape sequences', () => {
            const scanner = new Scanner('"hello \\"world\\""');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.StringLiteral);
            expect(tokens[0].text).toContain('\\"');
        });

        it('should report error for unterminated string', () => {
            const scanner = new Scanner('"hello');
            const tokens = scanner.scanTokens();
            const diagnostics = scanner.getDiagnostics();

            expect(tokens[0].kind).toBe(SyntaxKind.StringLiteral);
            expect(diagnostics.length).toBe(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
        });
    });

    describe('Punctuation', () => {
        const punctuation = [
            ['{', SyntaxKind.OpenBraceToken],
            ['}', SyntaxKind.CloseBraceToken],
            ['[', SyntaxKind.OpenBracketToken],
            [']', SyntaxKind.CloseBracketToken],
            ['(', SyntaxKind.OpenParenToken],
            [')', SyntaxKind.CloseParenToken],
            [':', SyntaxKind.ColonToken],
            [',', SyntaxKind.CommaToken],
            ['.', SyntaxKind.DotToken],
            ['=', SyntaxKind.EqualsToken],
        ];

        punctuation.forEach(([text, kind]) => {
            it(`should scan '${text}' token`, () => {
                const scanner = new Scanner(text as string);
                const tokens = scanner.scanTokens();
                expect(tokens[0].kind).toBe(kind);
                expect(tokens[0].text).toBe(text);
            });
        });

        it('should scan multiple punctuation tokens', () => {
            const scanner = new Scanner('()[]{}');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.OpenParenToken);
            expect(tokens[1].kind).toBe(SyntaxKind.CloseParenToken);
            expect(tokens[2].kind).toBe(SyntaxKind.OpenBracketToken);
            expect(tokens[3].kind).toBe(SyntaxKind.CloseBracketToken);
            expect(tokens[4].kind).toBe(SyntaxKind.OpenBraceToken);
            expect(tokens[5].kind).toBe(SyntaxKind.CloseBraceToken);
        });
    });

    describe('Trivia handling', () => {
        it('should attach leading whitespace as trivia', () => {
            const scanner = new Scanner('  hello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia).toBeDefined();
            expect(tokens[0].leadingTrivia?.length).toBe(1);
            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.WhitespaceTrivia);
            expect(tokens[0].leadingTrivia?.[0].text).toBe('  ');
        });

        it('should attach tab as whitespace trivia', () => {
            const scanner = new Scanner('\thello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.WhitespaceTrivia);
            expect(tokens[0].leadingTrivia?.[0].text).toBe('\t');
        });

        it('should attach newline as trivia', () => {
            const scanner = new Scanner('\nhello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.NewLineTrivia);
        });

        it('should handle CRLF newlines', () => {
            const scanner = new Scanner('\r\nhello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.NewLineTrivia);
            expect(tokens[0].leadingTrivia?.[0].text).toBe('\r\n');
            expect(tokens[0].leadingTrivia?.[0].width).toBe(2);
        });

        it('should attach single-line comment as trivia', () => {
            const scanner = new Scanner('// comment\nhello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.length).toBe(2);
            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.SingleLineCommentTrivia);
            expect(tokens[0].leadingTrivia?.[0].text).toBe('// comment');
        });

        it('should attach multi-line comment as trivia', () => {
            const scanner = new Scanner('/* comment */hello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.[0].kind).toBe(SyntaxKind.MultiLineCommentTrivia);
            expect(tokens[0].leadingTrivia?.[0].text).toBe('/* comment */');
        });

        it('should report error for unterminated multi-line comment', () => {
            const scanner = new Scanner('/* comment');
            const _tokens = scanner.scanTokens();
            const diagnostics = scanner.getDiagnostics();

            expect(diagnostics.length).toBe(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
            expect(diagnostics[0].message).toContain('Unterminated');
        });

        it('should handle multiple trivia items', () => {
            const scanner = new Scanner('  \t\n// comment\n  hello');
            const tokens = scanner.scanTokens();

            expect(tokens[0].leadingTrivia?.length).toBeGreaterThan(1);
        });
    });

    describe('Complex scenarios', () => {
        it('should scan simple statement', () => {
            const scanner = new Scanner('define PI = 3.14');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.DefineKeyword);
            expect(tokens[1].kind).toBe(SyntaxKind.Identifier);
            expect(tokens[1].text).toBe('PI');
            expect(tokens[2].kind).toBe(SyntaxKind.EqualsToken);
            expect(tokens[3].kind).toBe(SyntaxKind.NumericLiteral);
        });

        it('should scan if statement', () => {
            const scanner = new Scanner('if flag 10 { }');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.IfKeyword);
            expect(tokens[1].kind).toBe(SyntaxKind.FlagKeyword);
            expect(tokens[2].kind).toBe(SyntaxKind.NumericLiteral);
            expect(tokens[3].kind).toBe(SyntaxKind.OpenBraceToken);
            expect(tokens[4].kind).toBe(SyntaxKind.CloseBraceToken);
        });

        it('should scan ROM access', () => {
            const scanner = new Scanner('rom[0x1000] = 0xFF');
            const tokens = scanner.scanTokens();

            expect(tokens[0].kind).toBe(SyntaxKind.ROMKeyword);
            expect(tokens[1].kind).toBe(SyntaxKind.OpenBracketToken);
            expect(tokens[2].kind).toBe(SyntaxKind.HexLiteral);
            expect(tokens[3].kind).toBe(SyntaxKind.CloseBracketToken);
            expect(tokens[4].kind).toBe(SyntaxKind.EqualsToken);
            expect(tokens[5].kind).toBe(SyntaxKind.HexLiteral);
        });

        it('should preserve all trivia in realistic code', () => {
            const source = `
// This is a comment
define VALUE = 42  // inline comment

/* Multi-line
   comment */
if flag 1 {
    // nested comment
}
`;
            const scanner = new Scanner(source);
            const tokens = scanner.scanTokens();

            // Verify trivia is attached
            const tokensWithCommentTrivia = tokens.filter(t =>
                t.leadingTrivia?.some(tr =>
                    tr.kind === SyntaxKind.SingleLineCommentTrivia ||
                    tr.kind === SyntaxKind.MultiLineCommentTrivia
                )
            );
            expect(tokensWithCommentTrivia.length).toBeGreaterThan(0);
        });
    });

    describe('Error recovery', () => {
        it('should recover from unexpected character', () => {
            const scanner = new Scanner('hello @ world');
            const tokens = scanner.scanTokens();
            const diagnostics = scanner.getDiagnostics();

            expect(tokens[0].text).toBe('hello');
            expect(tokens[1].kind).toBe(SyntaxKind.UnexpectedToken);
            expect(tokens[2].text).toBe('world');
            expect(diagnostics.length).toBe(1);
        });

        it('should continue scanning after error', () => {
            const scanner = new Scanner('define @ = 42');
            const _tokens = scanner.scanTokens();

            expect(_tokens[0].kind).toBe(SyntaxKind.DefineKeyword);
            expect(_tokens[_tokens.length - 1].kind).toBe(SyntaxKind.EndOfFileToken);
        });
    });

    describe('Position tracking', () => {
        it('should track token width including trivia', () => {
            const scanner = new Scanner('  hello');
            const tokens = scanner.scanTokens();

            // Width should include leading trivia
            expect(tokens[0].fullWidth).toBeGreaterThan(tokens[0].text.length);
        });

        it('should have correct widths for all tokens', () => {
            const scanner = new Scanner('a b c');
            const tokens = scanner.scanTokens();

            tokens.forEach(token => {
                expect(token.fullWidth).toBeGreaterThanOrEqual(0);
                // Non-EOF tokens should have positive width
                if (token.kind !== SyntaxKind.EndOfFileToken) {
                    expect(token.fullWidth).toBeGreaterThan(0);
                }
            });
        });
    });
});
