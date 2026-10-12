import { Scanner } from '../scanner';
import { SystemTestHarness } from './systemTestHarness';
import { SyntaxKind } from '../syntax/syntaxKind';

describe('Scanner with Fixtures', () => {
    let harness: SystemTestHarness;

    beforeAll(() => {
        harness = new SystemTestHarness();
    });

    describe('Scanning all fixtures', () => {
        it('should scan all fixtures without crashing', () => {
            const fixtures = harness.loadAllFixtures();
            
            fixtures.forEach(fixture => {
                const scanner = new Scanner(fixture.content);
                const tokens = scanner.scanTokens();
                
                // Should always end with EOF token
                expect(tokens[tokens.length - 1].kind).toBe(SyntaxKind.EndOfFileToken);
                
                // Should have at least EOF token
                expect(tokens.length).toBeGreaterThan(0);
            });
        });

        it('should produce valid tokens for all fixtures', () => {
            const fixtures = harness.loadAllFixtures();
            
            fixtures.forEach(fixture => {
                const scanner = new Scanner(fixture.content);
                const tokens = scanner.scanTokens();
                
                tokens.forEach(token => {
                    // All tokens should have a kind
                    expect(token.kind).toBeDefined();
                    expect(typeof token.kind).toBe('number');
                    
                    // All tokens should have text (can be empty for EOF)
                    expect(token.text).toBeDefined();
                    
                    // All tokens should have width >= 0
                    expect(token.fullWidth).toBeGreaterThanOrEqual(0);
                });
            });
        });
    });

    describe('01-literals.ccs', () => {
        it('should recognize define keyword', () => {
            const fixture = harness.loadFixture('01-literals.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            const defineTokens = tokens.filter(t => t.kind === SyntaxKind.DefineKeyword);
            expect(defineTokens.length).toBeGreaterThan(0);
        });

        it('should recognize numeric and hex literals', () => {
            const fixture = harness.loadFixture('01-literals.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            const numericLiterals = tokens.filter(t => t.kind === SyntaxKind.NumericLiteral);
            const hexLiterals = tokens.filter(t => t.kind === SyntaxKind.HexLiteral);
            
            expect(numericLiterals.length).toBeGreaterThan(0);
            expect(hexLiterals.length).toBeGreaterThan(0);
        });
    });

    describe('04-conditionals.ccs', () => {
        it('should recognize if and else keywords', () => {
            const fixture = harness.loadFixture('04-conditionals.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            const ifTokens = tokens.filter(t => t.kind === SyntaxKind.IfKeyword);
            const elseTokens = tokens.filter(t => t.kind === SyntaxKind.ElseKeyword);
            
            expect(ifTokens.length).toBeGreaterThan(0);
            expect(elseTokens.length).toBeGreaterThan(0);
        });

        it('should recognize flag keyword', () => {
            const fixture = harness.loadFixture('04-conditionals.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            const flagTokens = tokens.filter(t => t.kind === SyntaxKind.FlagKeyword);
            expect(flagTokens.length).toBeGreaterThan(0);
        });
    });

    describe('10-comments.ccs', () => {
        it('should preserve comments as trivia', () => {
            const fixture = harness.loadFixture('10-comments.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            const tokensWithSingleLineComments = tokens.filter(t =>
                t.leadingTrivia?.some(tr => tr.kind === SyntaxKind.SingleLineCommentTrivia)
            );
            const tokensWithMultiLineComments = tokens.filter(t =>
                t.leadingTrivia?.some(tr => tr.kind === SyntaxKind.MultiLineCommentTrivia)
            );
            
            expect(tokensWithSingleLineComments.length).toBeGreaterThan(0);
            expect(tokensWithMultiLineComments.length).toBeGreaterThan(0);
        });
    });

    describe('12-comprehensive.ccs', () => {
        it('should scan comprehensive fixture successfully', () => {
            const fixture = harness.loadFixture('12-comprehensive.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            const diagnostics = scanner.getDiagnostics();
            
            // Should produce many tokens
            expect(tokens.length).toBeGreaterThan(50);
            
            // Should have minimal errors (comprehensive fixture is valid)
            expect(diagnostics.length).toBeLessThan(5);
        });

        it('should recognize all keyword types', () => {
            const fixture = harness.loadFixture('12-comprehensive.ccs');
            const scanner = new Scanner(fixture.content);
            const tokens = scanner.scanTokens();
            
            // Check for various keywords
            const keywordKinds = [
                SyntaxKind.DefineKeyword,
                SyntaxKind.CommandKeyword,
                SyntaxKind.IfKeyword,
                SyntaxKind.ElseKeyword,
                SyntaxKind.MenuKeyword,
                SyntaxKind.FlagKeyword,
            ];
            
            keywordKinds.forEach(kind => {
                const found = tokens.some(t => t.kind === kind);
                expect(found).toBe(true);
            });
        });
    });

    describe('Error handling', () => {
        it('should not crash on invalid input', () => {
            const invalidSources = [
                '@@@@',
                '/* unterminated comment',
                '"unterminated string',
                '0x',  // hex without digits
            ];
            
            invalidSources.forEach(source => {
                const scanner = new Scanner(source);
                const tokens = scanner.scanTokens();
                const diagnostics = scanner.getDiagnostics();
                
                // Should still produce EOF token
                expect(tokens[tokens.length - 1].kind).toBe(SyntaxKind.EndOfFileToken);
                
                // Should report errors
                expect(diagnostics.length).toBeGreaterThan(0);
            });
        });
    });
});
