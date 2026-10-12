/**
 * AST Snapshot Tests
 * 
 * Creates snapshot tests that dump the full AST structure including
 * all tokens, trivia, positions, and widths to help debug parsing issues.
 */

import { SyntaxTree } from './syntaxTree';
import { RedNode, RedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import { SystemTestHarness } from './test/systemTestHarness';

/**
 * Serialize an AST node to a readable string representation
 */
function serializeAST(node: RedNode, indent = 0, source = ''): string {
    const indentStr = '  '.repeat(indent);
    const kindName = SyntaxKind[node.kind];

    // Show fullSpan (position..end including trivia) and fullWidth
    const fullEnd = node.position + node.fullWidth;
    let result = `${indentStr}${kindName} [${node.position}..${fullEnd}) fullWidth=${node.fullWidth}`;

    // For tokens, show the text (just the token text, not trivia) and create trivia grouping nodes
    if (node instanceof RedToken) {
        // Use the token text stored in the green node (not extracted from source)
        const tokenText = node.text;
        const escapedText = tokenText.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
        result += ` text="${escapedText}"`;
        result += '\n';

        const leadingTrivia = node.getLeadingTrivia();
        const trailingTrivia = node.getTrailingTrivia();

        // Create leading trivia grouping node
        if (leadingTrivia.length > 0) {
            const leadingWidth = leadingTrivia.reduce((sum, t) => sum + t.width, 0);
            const leadingStart = node.position;
            const leadingEnd = leadingStart + leadingWidth;
            result += `${indentStr}  LeadingTrivia [${leadingStart}..${leadingEnd}) fullWidth=${leadingWidth}\n`;
            for (const trivia of leadingTrivia) {
                const triviaText = trivia.text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                result += `${indentStr}    ${SyntaxKind[trivia.kind]} width=${trivia.width} "${triviaText}"\n`;
            }
        }

        // Create trailing trivia grouping node
        if (trailingTrivia.length > 0) {
            const trailingWidth = trailingTrivia.reduce((sum, t) => sum + t.width, 0);
            const trailingStart = node.position + node.fullWidth - trailingWidth;
            const trailingEnd = trailingStart + trailingWidth;
            result += `${indentStr}  TrailingTrivia [${trailingStart}..${trailingEnd}) fullWidth=${trailingWidth}\n`;
            for (const trivia of trailingTrivia) {
                const triviaText = trivia.text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                result += `${indentStr}    ${SyntaxKind[trivia.kind]} width=${trivia.width} "${triviaText}"\n`;
            }
        }
    } else {
        result += '\n';
    }

    // Recursively serialize children
    const children = node.getChildren();
    for (const child of children) {
        result += serializeAST(child, indent + 1, source);
    }

    return result;
}

describe('AST Snapshots', () => {
    const harness = new SystemTestHarness();
    const fixtures = harness.loadAllFixtures();

    it.each(fixtures)('should match AST snapshot for $name', (fixture) => {
        const tree = SyntaxTree.parse(fixture.content);
        const ast = serializeAST(tree.getRoot(), 0, fixture.content);
        expect(ast).toMatchSnapshot();
    });
});
