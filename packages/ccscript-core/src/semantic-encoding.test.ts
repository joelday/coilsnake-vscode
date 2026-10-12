import { SyntaxTree } from './syntaxTree';
import { SyntaxKind } from './syntax/syntaxKind';
import * as fs from 'fs';
import * as path from 'path';

describe('Semantic token encoding test', () => {
    it('should show semantic token encoding for shop_item parameters', () => {
        const filePath = path.join(__dirname, '..', 'reference-tests', 'ccscript1337', 'hack_shoptest.ccs');

        const content = fs.readFileSync(filePath, 'utf-8');
        const tree = SyntaxTree.parse(content);
        const root = tree.getRoot();

        // Get all tokens
        const allTokens = root.getTokens();

        // Find tokens around "command shop_item(item, price)"
        const commandIdx = allTokens.findIndex(t => t.text === 'command');

        console.log('\nTokens from command keyword through close paren:');

        // Simulate what the language server does
        let prevLine = 0;
        let prevChar = 0;

        for (let i = commandIdx; i < Math.min(commandIdx + 10, allTokens.length); i++) {
            const token = allTokens[i];

            // Skip trivia
            if (token.kind >= SyntaxKind.WhitespaceTrivia && token.kind <= SyntaxKind.MultiLineCommentTrivia) {
                continue;
            }

            // Calculate position after leading trivia (what LSP does)
            const leadingTriviaWidth = token.getLeadingTrivia().reduce((sum, t) => sum + t.width, 0);
            const tokenPosition = token.position + leadingTriviaWidth;

            // Convert to line/character using our getLineAndColumn
            const ourPos = tree.getLineAndColumn(tokenPosition);

            // Calculate delta (what semantic tokens encode)
            const deltaLine = ourPos.line - prevLine;
            const deltaChar = deltaLine === 0 ? ourPos.column - prevChar : ourPos.column;

            console.log(`\nToken: "${token.text}" (${SyntaxKind[token.kind]})`);
            console.log(`  Raw position: ${token.position}, +leadingTrivia: ${tokenPosition}`);
            console.log(`  Line/Col: (${ourPos.line}, ${ourPos.column})`);
            console.log(`  Delta: (${deltaLine}, ${deltaChar})`);
            console.log(`  Length: ${token.text.length}`);
            console.log(`  Semantic token encoding: [${deltaLine}, ${deltaChar}, ${token.text.length}, ...]`);

            // Show actual characters at position
            const actualText = content.substring(tokenPosition, tokenPosition + token.text.length);
            const displayText = actualText.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
            console.log(`  Actual text at position: "${displayText}"`);

            if (actualText !== token.text) {
                console.log(`  ❌ MISMATCH! Expected "${token.text}"`);
            }

            prevLine = ourPos.line;
            prevChar = ourPos.column;
        }
    });
});
