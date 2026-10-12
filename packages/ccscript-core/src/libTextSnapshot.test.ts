/**
 * AST Snapshot Test for lib_text.ccs
 * 
 * This is a separate snapshot test for the lib_text.ccs file from the
 * CCScript reference compiler test suite. It demonstrates proper parsing
 * of call expressions with multiple arguments and comma tokens.
 */

import { SyntaxTree } from './syntaxTree';
import { RedNode, RedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Serialize an AST node to a readable string representation
 */
function serializeAST(node: RedNode, indent = 0): string {
    const indentStr = '  '.repeat(indent);
    const kindName = SyntaxKind[node.kind];

    // Show fullSpan (position..end including trivia) and fullWidth
    const fullEnd = node.position + node.fullWidth;
    let result = `${indentStr}${kindName} [${node.position}..${fullEnd}) fullWidth=${node.fullWidth}`;

    // For tokens, show the text and create trivia grouping nodes
    if (node instanceof RedToken) {
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
        result += serializeAST(child, indent + 1);
    }

    return result;
}

describe('lib_text.ccs AST Snapshot', () => {
    it('should match AST snapshot for lib_text.ccs', () => {
        // lib_text.ccs from the vendored CCScript 1.337 reference tests
        const libTextPath = path.join(__dirname, '..', 'reference-tests', 'ccscript1337', 'lib_text.ccs');

        const content = fs.readFileSync(libTextPath, 'utf-8');
        const tree = SyntaxTree.parse(content);
        const ast = serializeAST(tree.getRoot());

        expect(ast).toMatchSnapshot();
    });
});
