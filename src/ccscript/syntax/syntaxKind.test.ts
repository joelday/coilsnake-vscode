import { SyntaxKind } from './syntaxKind';

describe('SyntaxKind', () => {
    describe('Token kinds', () => {
        it('should have end of file token', () => {
            expect(SyntaxKind.EndOfFileToken).toBeDefined();
            expect(typeof SyntaxKind.EndOfFileToken).toBe('number');
        });

        it('should have identifier', () => {
            expect(SyntaxKind.Identifier).toBeDefined();
        });

        it('should have literal kinds', () => {
            expect(SyntaxKind.NumericLiteral).toBeDefined();
            expect(SyntaxKind.StringLiteral).toBeDefined();
            expect(SyntaxKind.HexLiteral).toBeDefined();
        });

        it('should have punctuation tokens', () => {
            expect(SyntaxKind.OpenBraceToken).toBeDefined();
            expect(SyntaxKind.CloseBraceToken).toBeDefined();
            expect(SyntaxKind.OpenParenToken).toBeDefined();
            expect(SyntaxKind.CloseParenToken).toBeDefined();
            expect(SyntaxKind.OpenBracketToken).toBeDefined();
            expect(SyntaxKind.CloseBracketToken).toBeDefined();
            expect(SyntaxKind.ColonToken).toBeDefined();
            expect(SyntaxKind.CommaToken).toBeDefined();
            expect(SyntaxKind.DotToken).toBeDefined();
        });

        it('should have operator and special tokens', () => {
            expect(SyntaxKind.SlashToken).toBeDefined();
            expect(SyntaxKind.PipeToken).toBeDefined();
            expect(SyntaxKind.EqualsToken).toBeDefined();
        });
    });

    describe('Keyword kinds', () => {
        it('should have control flow keywords', () => {
            expect(SyntaxKind.IfKeyword).toBeDefined();
            expect(SyntaxKind.ElseKeyword).toBeDefined();
            expect(SyntaxKind.NextKeyword).toBeDefined();
            expect(SyntaxKind.EndKeyword).toBeDefined();
        });

        it('should have declaration keywords', () => {
            expect(SyntaxKind.DefineKeyword).toBeDefined();
            expect(SyntaxKind.CommandKeyword).toBeDefined();
        });

        it('should have logical operator keywords', () => {
            expect(SyntaxKind.AndKeyword).toBeDefined();
            expect(SyntaxKind.OrKeyword).toBeDefined();
            expect(SyntaxKind.NotKeyword).toBeDefined();
        });

        it('should have ROM access keywords', () => {
            expect(SyntaxKind.ROMKeyword).toBeDefined();
            expect(SyntaxKind.ROMTBLKeyword).toBeDefined();
        });

        it('should have type keywords', () => {
            expect(SyntaxKind.ByteKeyword).toBeDefined();
            expect(SyntaxKind.ShortKeyword).toBeDefined();
            expect(SyntaxKind.LongKeyword).toBeDefined();
        });

        it('should have game-specific keywords', () => {
            expect(SyntaxKind.FlagKeyword).toBeDefined();
            expect(SyntaxKind.MenuKeyword).toBeDefined();
            expect(SyntaxKind.DefaultKeyword).toBeDefined();
        });



        it('should have boolean literals', () => {
            expect(SyntaxKind.TrueKeyword).toBeDefined();
            expect(SyntaxKind.FalseKeyword).toBeDefined();
        });
    });

    describe('Node kinds', () => {
        it('should have source file kind', () => {
            expect(SyntaxKind.SourceFile).toBeDefined();
        });

        it('should have statement kinds', () => {
            expect(SyntaxKind.BlockStatement).toBeDefined();
            expect(SyntaxKind.IfStatement).toBeDefined();
            expect(SyntaxKind.MenuStatement).toBeDefined();
            expect(SyntaxKind.MenuOption).toBeDefined();
            expect(SyntaxKind.LabelDeclaration).toBeDefined();
            expect(SyntaxKind.ConstantDeclaration).toBeDefined();
            expect(SyntaxKind.CommandDeclaration).toBeDefined();
            expect(SyntaxKind.ROMWriteStatement).toBeDefined();
            expect(SyntaxKind.ROMTableWriteStatement).toBeDefined();
            expect(SyntaxKind.ExpressionStatement).toBeDefined();
            expect(SyntaxKind.ErrorStatement).toBeDefined();
        });

        it('should have expression kinds', () => {
            expect(SyntaxKind.NumericLiteralExpression).toBeDefined();
            expect(SyntaxKind.StringLiteralExpression).toBeDefined();
            expect(SyntaxKind.BooleanLiteralExpression).toBeDefined();
            expect(SyntaxKind.IdentifierExpression).toBeDefined();
            expect(SyntaxKind.QualifiedNameExpression).toBeDefined();
            expect(SyntaxKind.CallExpression).toBeDefined();
            expect(SyntaxKind.BinaryExpression).toBeDefined();
            expect(SyntaxKind.UnaryExpression).toBeDefined();
            expect(SyntaxKind.FlagExpression).toBeDefined();
            expect(SyntaxKind.ArrayAccessExpression).toBeDefined();
            expect(SyntaxKind.StringTemplateExpression).toBeDefined();
            expect(SyntaxKind.ErrorExpression).toBeDefined();
        });
    });

    describe('Trivia kinds', () => {
        it('should have trivia kinds', () => {
            expect(SyntaxKind.WhitespaceTrivia).toBeDefined();
            expect(SyntaxKind.NewLineTrivia).toBeDefined();
            expect(SyntaxKind.SingleLineCommentTrivia).toBeDefined();
            expect(SyntaxKind.MultiLineCommentTrivia).toBeDefined();
        });
    });

    describe('Enum values', () => {
        it('should have unique values', () => {
            const values = Object.values(SyntaxKind).filter(v => typeof v === 'number');
            const uniqueValues = new Set(values);
            expect(values.length).toBe(uniqueValues.size);
        });

        it('should be numeric', () => {
            const numericValues = Object.values(SyntaxKind).filter(v => typeof v === 'number');
            expect(numericValues.length).toBeGreaterThan(0);
            numericValues.forEach(value => {
                expect(typeof value).toBe('number');
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Enum consistency', () => {
        it('should have string keys for all enum members', () => {
            const keys = Object.keys(SyntaxKind).filter(k => isNaN(Number(k)));
            expect(keys.length).toBeGreaterThan(0);
            keys.forEach(key => {
                expect(typeof key).toBe('string');
                expect(key.length).toBeGreaterThan(0);
            });
        });

        it('should follow PascalCase naming convention', () => {
            const keys = Object.keys(SyntaxKind).filter(k => isNaN(Number(k)));
            const enumKeys = keys.filter(k => typeof SyntaxKind[k as keyof typeof SyntaxKind] === 'number');
            enumKeys.forEach(key => {
                // First character should be uppercase
                expect(key[0]).toBe(key[0].toUpperCase());
                // Should not contain underscores (PascalCase, not snake_case)
                expect(key).not.toContain('_');
            });
        });
    });
});
