import { SyntaxTree } from './syntaxTree';
import { RedToken } from './redNode';

describe('Width calculation fix', () => {
    it('should calculate width excluding trivia for nodes', () => {
        const source = '"Text position:" text_pos(10, 1)';
        const tree = SyntaxTree.parse(source);
        const root = tree.getRoot();

        // Get the first expression statement (the string literal)
        const firstStmt = root.getChildren()[0]; // ExpressionStatement
        const stringExpr = firstStmt.getChildren()[0]; // StringLiteralExpression
        const stringToken = stringExpr.getChildren()[0] as RedToken; // StringLiteral token

        // String literal: "Text position:" with trailing space
        // Position 0, fullWidth = 17 (includes trailing space trivia)
        // width should be 16 (just the string token text: "Text position:")
        console.log(`StringLiteral position=${stringToken.position} fullWidth=${stringToken.fullWidth} width=${stringToken.width}`);
        expect(stringToken.fullWidth).toBe(17); // Token text (16) + trailing space (1)
        expect(stringToken.width).toBe(16); // Just "Text position:"
        expect(stringToken.text).toBe('"Text position:"');

        // Check the span (should exclude trailing trivia)
        const span = stringToken.span;
        expect(span.start).toBe(0); // No leading trivia
        expect(span.length).toBe(16); // Just the token text, no trailing space

        // Now check the call expression
        const secondStmt = root.getChildren()[1]; // Second ExpressionStatement
        const callExpr = secondStmt.getChildren()[0]; // CallExpression

        // CallExpression should have correct width (excluding trailing newline from close paren)
        console.log(`CallExpression position=${callExpr.position} fullWidth=${callExpr.fullWidth} width=${callExpr.width}`);

        // Get the argument list (second child after target)
        const callChildren = callExpr.getChildren();
        const argumentList = callChildren[1]; // ArgumentList is second child

        // Get the close paren token (last child of argumentList)
        const argListChildren = argumentList.getChildren();
        const closeParen = argListChildren[argListChildren.length - 1] as RedToken;

        console.log(`CloseParenToken position=${closeParen.position} fullWidth=${closeParen.fullWidth} width=${closeParen.width}`);
        console.log(`CloseParenToken trailing trivia width=${closeParen.getTrailingTriviaWidth()}`);

        // The close paren ")" has trailing newline trivia
        expect(closeParen.text).toBe(')');
        expect(closeParen.width).toBe(1); // Just ")"

        // CallExpression width should exclude the trailing newline from close paren
        const callLeadingWidth = callExpr.getLeadingTriviaWidth();
        const callTrailingWidth = callExpr.getTrailingTriviaWidth();
        console.log(`CallExpression leading=${callLeadingWidth} trailing=${callTrailingWidth}`);

        // width = fullWidth - leading - trailing
        expect(callExpr.width).toBe(callExpr.fullWidth - callLeadingWidth - callTrailingWidth);
    });

    it('should provide correct span for semantic highlighting', () => {
        const source = '"Text position:" text_pos(10, 1)\n"Text color:" text_color(4)';
        const tree = SyntaxTree.parse(source);
        const tokens = tree.getRoot().getTokens();

        // Find the numeric literal "1" 
        const numericOne = tokens.find(t => t.text === '1');
        expect(numericOne).toBeDefined();

        if (numericOne) {
            console.log(`Numeric "1" position=${numericOne.position} fullWidth=${numericOne.fullWidth} width=${numericOne.width}`);
            console.log(`Numeric "1" span.start=${numericOne.span.start} span.length=${numericOne.span.length}`);

            // The "1" should have correct span
            expect(numericOne.width).toBe(1);
            expect(numericOne.span.length).toBe(1);

            // Verify the text at the span location is "1"
            const textAtSpan = source.substring(numericOne.span.start, numericOne.span.start + numericOne.span.length);
            expect(textAtSpan).toBe('1');
        }

        // Find the second string literal "Text color:"
        const secondString = tokens.find(t => t.text === '"Text color:"');
        expect(secondString).toBeDefined();

        if (secondString) {
            console.log(`String "Text color:" position=${secondString.position} fullWidth=${secondString.fullWidth} width=${secondString.width}`);
            console.log(`String span.start=${secondString.span.start} span.length=${secondString.span.length}`);

            // The string should have correct span (excluding trailing space)
            expect(secondString.text).toBe('"Text color:"');
            expect(secondString.width).toBe(13);
            expect(secondString.span.length).toBe(13);

            // Verify the text at the span location doesn't include trailing trivia
            const textAtSpan = source.substring(secondString.span.start, secondString.span.start + secondString.span.length);
            expect(textAtSpan).toBe('"Text color:"');
            expect(textAtSpan).not.toContain('\n');
        }
    });
});
