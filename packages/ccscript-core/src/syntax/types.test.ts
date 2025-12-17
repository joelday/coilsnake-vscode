import { SyntaxKind } from './syntaxKind';
import {
    TextSpan,
    DiagnosticSeverity,
    Diagnostic,
    GreenNode,
    GreenToken,
    GreenTrivia,
    RedNode,
    GreenSourceFile,
    GreenExpression,
    GreenStatement,
    isNodeOfKind,
} from './types';

describe('CCScript Type System', () => {
    describe('TextSpan', () => {
        it('should represent a text position', () => {
            const span: TextSpan = { start: 10, length: 5 };
            expect(span.start).toBe(10);
            expect(span.length).toBe(5);
        });
    });

    describe('DiagnosticSeverity', () => {
        it('should have all severity levels', () => {
            expect(DiagnosticSeverity.Error).toBeDefined();
            expect(DiagnosticSeverity.Warning).toBeDefined();
            expect(DiagnosticSeverity.Info).toBeDefined();
            expect(DiagnosticSeverity.Hint).toBeDefined();
        });

        it('should be numeric', () => {
            expect(typeof DiagnosticSeverity.Error).toBe('number');
            expect(typeof DiagnosticSeverity.Warning).toBe('number');
        });
    });

    describe('Diagnostic', () => {
        it('should contain span, severity, and message', () => {
            const diagnostic: Diagnostic = {
                span: { start: 0, length: 5 },
                severity: DiagnosticSeverity.Error,
                message: 'Test error',
            };
            expect(diagnostic.span).toBeDefined();
            expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
            expect(diagnostic.message).toBe('Test error');
        });

        it('should optionally have error code', () => {
            const diagnostic: Diagnostic = {
                span: { start: 0, length: 5 },
                severity: DiagnosticSeverity.Error,
                message: 'Test error',
                code: 'CS001',
            };
            expect(diagnostic.code).toBe('CS001');
        });
    });

    describe('GreenNode', () => {
        it('should have kind and width', () => {
            const node: GreenNode = {
                kind: SyntaxKind.SourceFile,
                width: 100,
                children: [],
            };
            expect(node.kind).toBe(SyntaxKind.SourceFile);
            expect(node.width).toBe(100);
            expect(node.children).toEqual([]);
        });
    });

    describe('GreenToken', () => {
        it('should extend GreenNode with text', () => {
            const token: GreenToken = {
                kind: SyntaxKind.Identifier,
                width: 5,
                text: 'hello',
                children: [],
            };
            expect(token.kind).toBe(SyntaxKind.Identifier);
            expect(token.text).toBe('hello');
            expect(token.width).toBe(5);
        });

        it('should optionally have trivia', () => {
            const trivia: GreenTrivia = {
                kind: SyntaxKind.WhitespaceTrivia,
                text: '  ',
                width: 2,
            };
            const token: GreenToken = {
                kind: SyntaxKind.Identifier,
                width: 7,
                text: 'hello',
                leadingTrivia: [trivia],
                children: [],
            };
            expect(token.leadingTrivia).toBeDefined();
            expect(token.leadingTrivia?.length).toBe(1);
            expect(token.leadingTrivia?.[0].kind).toBe(SyntaxKind.WhitespaceTrivia);
        });
    });

    describe('GreenTrivia', () => {
        it('should have trivia kind, text, and width', () => {
            const trivia: GreenTrivia = {
                kind: SyntaxKind.SingleLineCommentTrivia,
                text: '// comment',
                width: 10,
            };
            expect(trivia.kind).toBe(SyntaxKind.SingleLineCommentTrivia);
            expect(trivia.text).toBe('// comment');
            expect(trivia.width).toBe(10);
        });

        it('should support all trivia kinds', () => {
            const whitespace: GreenTrivia = {
                kind: SyntaxKind.WhitespaceTrivia,
                text: ' ',
                width: 1,
            };
            const newline: GreenTrivia = {
                kind: SyntaxKind.NewLineTrivia,
                text: '\n',
                width: 1,
            };
            const singleComment: GreenTrivia = {
                kind: SyntaxKind.SingleLineCommentTrivia,
                text: '// test',
                width: 7,
            };
            const multiComment: GreenTrivia = {
                kind: SyntaxKind.MultiLineCommentTrivia,
                text: '/* test */',
                width: 10,
            };

            expect(whitespace.kind).toBe(SyntaxKind.WhitespaceTrivia);
            expect(newline.kind).toBe(SyntaxKind.NewLineTrivia);
            expect(singleComment.kind).toBe(SyntaxKind.SingleLineCommentTrivia);
            expect(multiComment.kind).toBe(SyntaxKind.MultiLineCommentTrivia);
        });
    });

    describe('RedNode interface', () => {
        it('should define position and parent properties', () => {
            // We can't easily create a real RedNode without implementing the class,
            // but we can verify the interface structure through type checking
            const mockRedNode: Partial<RedNode> = {
                kind: SyntaxKind.SourceFile,
                position: 0,
                parent: null,
            };
            expect(mockRedNode.kind).toBe(SyntaxKind.SourceFile);
            expect(mockRedNode.position).toBe(0);
            expect(mockRedNode.parent).toBeNull();
        });
    });

    describe('Specific node types', () => {
        it('should define GreenSourceFile', () => {
            const token: GreenToken = {
                kind: SyntaxKind.EndOfFileToken,
                width: 0,
                text: '',
                children: [],
            };
            const sourceFile: GreenSourceFile = {
                kind: SyntaxKind.SourceFile,
                width: 0,
                children: [],
                statements: [],
                endOfFileToken: token,
            };
            expect(sourceFile.kind).toBe(SyntaxKind.SourceFile);
            expect(sourceFile.statements).toEqual([]);
            expect(sourceFile.endOfFileToken).toBe(token);
        });

        it('should define statement types', () => {
            // Just verify the types exist and can be used
            const statements: GreenStatement[] = [];
            expect(Array.isArray(statements)).toBe(true);
        });

        it('should define expression types', () => {
            // Just verify the types exist and can be used
            const expressions: GreenExpression[] = [];
            expect(Array.isArray(expressions)).toBe(true);
        });
    });

    describe('isNodeOfKind type guard', () => {
        it('should check node kind correctly', () => {
            const node: GreenNode = {
                kind: SyntaxKind.SourceFile,
                width: 100,
                children: [],
            };
            expect(isNodeOfKind(node, SyntaxKind.SourceFile)).toBe(true);
            expect(isNodeOfKind(node, SyntaxKind.BlockStatement)).toBe(false);
        });

        it('should work with specific node types', () => {
            const token: GreenToken = {
                kind: SyntaxKind.EndOfFileToken,
                width: 0,
                text: '',
                children: [],
            };
            const sourceFile: GreenSourceFile = {
                kind: SyntaxKind.SourceFile,
                width: 0,
                children: [],
                statements: [],
                endOfFileToken: token,
            };
            expect(isNodeOfKind(sourceFile, SyntaxKind.SourceFile)).toBe(true);
        });
    });

    describe('Type consistency', () => {
        it('should ensure all node kinds are covered', () => {
            // This test verifies that we have types for key syntax kinds
            const kindsThatShouldHaveTypes = [
                SyntaxKind.SourceFile,
                SyntaxKind.BlockStatement,
                SyntaxKind.IfStatement,
                SyntaxKind.MenuStatement,
                SyntaxKind.LabelDeclaration,
                SyntaxKind.ConstantDeclaration,
                SyntaxKind.CommandDeclaration,
                SyntaxKind.ROMWriteStatement,
                SyntaxKind.ROMTableWriteStatement,
                SyntaxKind.ExpressionStatement,
                SyntaxKind.NumericLiteralExpression,
                SyntaxKind.StringLiteralExpression,
                SyntaxKind.IdentifierExpression,
                SyntaxKind.CallExpression,
                SyntaxKind.BinaryExpression,
                SyntaxKind.UnaryExpression,
            ];

            kindsThatShouldHaveTypes.forEach(kind => {
                expect(kind).toBeDefined();
                expect(typeof kind).toBe('number');
            });
        });
    });
});
