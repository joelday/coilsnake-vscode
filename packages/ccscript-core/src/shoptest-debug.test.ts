import { SyntaxTree } from './syntaxTree';
import { RedToken, isRedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import * as fs from 'fs';
import * as path from 'path';

describe('hack_shoptest.ccs position investigation', () => {
    it('should check for trivia overlap between consecutive tokens', () => {
        const filePath = path.join(
            __dirname,
            '..',
            '..',
            '..',
            'ccscript-compiler',
            'ccscript13',
            'src',
            'tests',
            'hack_shoptest.ccs'
        );

        const content = fs.readFileSync(filePath, 'utf-8');
        const tree = SyntaxTree.parse(content);
        const root = tree.getRoot();

        // Get all tokens in order
        const tokens = root.getTokens();

        console.log(`\nChecking ${tokens.length} tokens for trivia overlap...`);

        let overlapCount = 0;
        let gapCount = 0;

        for (let i = 0; i < tokens.length - 1; i++) {
            const token1 = tokens[i];
            const token2 = tokens[i + 1];

            // Calculate where token1's trailing trivia ends
            const token1End = token1.position + token1.fullWidth;

            // Token2's leading trivia starts at token2.position
            const token2Start = token2.position;

            if (token1End > token2Start) {
                // OVERLAP!
                overlapCount++;
                if (overlapCount <= 3) {
                    console.log(`\n❌ OVERLAP #${overlapCount}:`);
                    console.log(`   Token1: ${SyntaxKind[token1.kind]} "${token1.text}" at [${token1.position}..${token1End})`);
                    console.log(`   Token2: ${SyntaxKind[token2.kind]} "${token2.text}" at [${token2Start}..${token2.position + token2.fullWidth})`);
                    console.log(`   Overlap: ${token1End - token2Start} characters`);
                    console.log(`   Token1 trailing trivia: ${token1.getTrailingTrivia().map(t => `${SyntaxKind[t.kind]}(${t.width})`).join(', ')}`);
                    console.log(`   Token2 leading trivia: ${token2.getLeadingTrivia().map(t => `${SyntaxKind[t.kind]}(${t.width})`).join(', ')}`);

                    // Show the overlapping region
                    const overlapStart = Math.max(token1.position + token1.fullWidth - 20, token1.position);
                    const overlapEnd = Math.min(token2.position + 20, content.length);
                    const overlapText = content.substring(overlapStart, overlapEnd).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                    console.log(`   Text region: "...${overlapText}..."`);
                }
            } else if (token1End < token2Start) {
                // GAP!
                gapCount++;
                if (gapCount <= 3) {
                    console.log(`\n⚠️  GAP #${gapCount}:`);
                    console.log(`   Token1: ${SyntaxKind[token1.kind]} "${token1.text}" ends at ${token1End}`);
                    console.log(`   Token2: ${SyntaxKind[token2.kind]} "${token2.text}" starts at ${token2Start}`);
                    console.log(`   Gap: ${token2Start - token1End} characters`);

                    // Show the gap content
                    const gapText = content.substring(token1End, token2Start).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                    console.log(`   Gap content: "${gapText}"`);
                }
            }
        }

        if (overlapCount > 3) {
            console.log(`\n... and ${overlapCount - 3} more overlaps`);
        }
        if (gapCount > 3) {
            console.log(`\n... and ${gapCount - 3} more gaps`);
        }

        console.log('\nSummary:');
        console.log(`   Total tokens: ${tokens.length}`);
        console.log(`   Overlaps: ${overlapCount}`);
        console.log(`   Gaps: ${gapCount}`);
        console.log(`   Perfect adjacency: ${tokens.length - 1 - overlapCount - gapCount}`);

        expect(overlapCount).toBe(0);
        expect(gapCount).toBe(0);
    });

    it('should have correct positions for shop_item command', () => {
        const filePath = path.join(
            __dirname,
            '..',
            '..',
            '..',
            'ccscript-compiler',
            'ccscript13',
            'src',
            'tests',
            'hack_shoptest.ccs'
        );

        const content = fs.readFileSync(filePath, 'utf-8');
        const tree = SyntaxTree.parse(content);
        const root = tree.getRoot();

        // Find the shop_item command declaration
        const commandDecls = root.getDescendants().filter(n =>
            n.kind === SyntaxKind.CommandDeclaration
        );

        console.log(`\nFound ${commandDecls.length} command declarations`);

        for (const cmd of commandDecls) {
            const nameToken = cmd.getDescendants().find(n =>
                isRedToken(n) && n.kind === SyntaxKind.Identifier
            ) as RedToken;

            if (nameToken) {
                console.log(`\nCommand: ${nameToken.text}`);
                console.log(`  Node Position: ${cmd.position}, FullWidth: ${cmd.fullWidth}, Width: ${cmd.width}`);
                console.log(`  Node Span: [${cmd.span.start}..${cmd.span.start + cmd.span.length})`);
                console.log(`  Leading trivia width: ${cmd.getLeadingTriviaWidth()}`);
                console.log(`  Trailing trivia width: ${cmd.getTrailingTriviaWidth()}`);

                // Get text at the node's position (includes leading trivia)
                const textAtNodePos = content.substring(cmd.position, cmd.position + 50).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                console.log(`  Text at node position: "${textAtNodePos}..."`);

                // Get text at the span position (excludes leading trivia)
                const textAtSpan = content.substring(cmd.span.start, cmd.span.start + 50).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                console.log(`  Text at span start: "${textAtSpan}..."`);

                // Find the command keyword token
                const cmdKeyword = cmd.getDescendants().find(n =>
                    isRedToken(n) && n.kind === SyntaxKind.CommandKeyword
                ) as RedToken;

                if (cmdKeyword) {
                    console.log(`  Command keyword position: ${cmdKeyword.position}, fullWidth: ${cmdKeyword.fullWidth}`);
                    console.log(`  Command keyword leading trivia: ${cmdKeyword.getLeadingTrivia().length} items`);
                    cmdKeyword.getLeadingTrivia().forEach((t, i) => {
                        const triviaText = t.text.substring(0, 30).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                        console.log(`    [${i}] ${SyntaxKind[t.kind]}: width=${t.width}, text="${triviaText}..."`);
                    });
                }

                // Check if there's a position gap after this node
                const nextSibling = cmd.getNextSibling();
                if (nextSibling) {
                    const expectedNextPos = cmd.position + cmd.fullWidth;
                    if (nextSibling.position !== expectedNextPos) {
                        console.log(`  ⚠️  GAP DETECTED! Next sibling at ${nextSibling.position}, expected ${expectedNextPos}`);
                        console.log(`     Gap size: ${nextSibling.position - expectedNextPos}`);
                    }
                }
            }
        }

        // Check for any position gaps in the tree
        const allNodes = root.getDescendants();
        let gapCount = 0;

        for (const node of allNodes) {
            const nextSibling = node.getNextSibling();
            if (nextSibling) {
                const expectedPos = node.position + node.fullWidth;
                if (nextSibling.position !== expectedPos) {
                    gapCount++;
                    if (gapCount <= 5) { // Only show first 5
                        console.log(`\n⚠️  Gap #${gapCount}:`);
                        console.log(`   ${SyntaxKind[node.kind]} [${node.position}..${node.position + node.fullWidth})`);
                        console.log(`   ${SyntaxKind[nextSibling.kind]} starts at ${nextSibling.position}, expected ${expectedPos}`);
                        console.log(`   Missing ${nextSibling.position - expectedPos} characters`);
                    }
                }
            }
        }

        if (gapCount > 5) {
            console.log(`\n... and ${gapCount - 5} more gaps`);
        }

        console.log(`\nTotal gaps found: ${gapCount}`);

        const diagnostics = tree.getDiagnostics();
        console.log(`\nParser diagnostics: ${diagnostics.length}`);
        if (diagnostics.length > 0) {
            diagnostics.forEach(d => {
                console.log(`  ${d.message} at ${d.span.start}`);
            });
        }

        expect(gapCount).toBe(0);
    });
});
