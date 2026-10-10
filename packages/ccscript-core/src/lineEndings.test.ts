/**
 * Tests for line ending handling in scanner and diagnostics.
 * Ensures that both LF and CRLF files produce correct diagnostic positions.
 */

import { SyntaxTree } from './syntaxTree';
import { RedToken } from './redNode';

describe('Line Ending Handling', () => {
    describe('Scanner with different line endings', () => {
        it('should handle LF line endings correctly', () => {
            const source = 'define x = 42\ndefine y = 99\ndefine =';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getDiagnostics();

            // Should have a syntax error on line 3 (missing identifier after define)
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = syntaxError.span.start;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2); // 0-indexed, so line 3 = index 2
        });

        it('should handle CRLF line endings correctly', () => {
            const source = 'define x = 42\r\ndefine y = 99\r\ndefine =';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getDiagnostics();

            // Should have a syntax error on line 3 (missing identifier after define)
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = syntaxError.span.start;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2); // 0-indexed, so line 3 = index 2
        });

        it('should handle mixed line endings', () => {
            const source = 'define x = 42\r\ndefine y = 99\ndefine =';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getDiagnostics();

            // Should still work with mixed endings
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = syntaxError.span.start;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2);
        });
    });

    describe('Position calculations', () => {
        it('should calculate same line numbers for same logical positions', () => {
            const sourceLF = 'define x = 42\ndefine y = 99\ndefine z = 1';
            const sourceCRLF = 'define x = 42\r\ndefine y = 99\r\ndefine z = 1';

            const treeLF = SyntaxTree.parse(sourceLF);
            const treeCRLF = SyntaxTree.parse(sourceCRLF);

            // Get the position of 'z' in both files
            const zPosLF = sourceLF.indexOf('z');
            const zPosCRLF = sourceCRLF.indexOf('z');

            const lineLF = treeLF.getLineAndColumn(zPosLF);
            const lineCRLF = treeCRLF.getLineAndColumn(zPosCRLF);

            // Line numbers should be the same
            expect(lineLF.line).toBe(lineCRLF.line);
            expect(lineLF.line).toBe(2); // Third line
        });

        it('should handle CRLF in trivia correctly', () => {
            const source = 'define x = 42\r\n// comment\r\ndefine y = 99';
            const tree = SyntaxTree.parse(source);

            // Get position of 'y'
            const yPos = source.indexOf('y');
            const { line } = tree.getLineAndColumn(yPos);

            expect(line).toBe(2); // Third line (after define x and comment)
        });
    });

    describe('Source reconstruction', () => {
        it('should reconstruct original source with LF from AST', () => {
            const source = 'define x = 42\ndefine y = 99\ncommand test() {\n    x\n}';
            const tree = SyntaxTree.parse(source);

            // Reconstruct source by traversing all tokens with trivia
            let reconstructed = '';
            const allNodes = tree.getRoot().getDescendants();
            const tokens = allNodes.filter(n => n instanceof RedToken) as RedToken[];

            for (const token of tokens) {
                // Add leading trivia
                const leadingTrivia = token.getLeadingTrivia();
                for (const trivia of leadingTrivia) {
                    reconstructed += trivia.text;
                }

                // Add token text
                reconstructed += token.text;

                // Add trailing trivia
                const trailingTrivia = token.getTrailingTrivia();
                for (const trivia of trailingTrivia) {
                    reconstructed += trivia.text;
                }
            }

            expect(reconstructed).toBe(source);
        });

        it('should reconstruct original source with CRLF from AST', () => {
            const source = 'define x = 42\r\ndefine y = 99\r\ncommand test() {\r\n    x\r\n}';
            const tree = SyntaxTree.parse(source);

            // Reconstruct source by traversing all tokens with trivia
            let reconstructed = '';
            const allNodes = tree.getRoot().getDescendants();
            const tokens = allNodes.filter(n => n instanceof RedToken) as RedToken[];

            for (const token of tokens) {
                // Add leading trivia
                const leadingTrivia = token.getLeadingTrivia();
                for (const trivia of leadingTrivia) {
                    reconstructed += trivia.text;
                }

                // Add token text
                reconstructed += token.text;

                // Add trailing trivia
                const trailingTrivia = token.getTrailingTrivia();
                for (const trivia of trailingTrivia) {
                    reconstructed += trivia.text;
                }
            }

            expect(reconstructed).toBe(source);
        });

        it('should reconstruct source with mixed line endings from AST', () => {
            const source = 'define x = 42\r\n// Comment\ndefine y = 99\n/* Block\r\ncomment */\r\ncommand test() { x }';
            const tree = SyntaxTree.parse(source);

            // Reconstruct source by traversing all tokens with trivia
            let reconstructed = '';
            const allNodes = tree.getRoot().getDescendants();
            const tokens = allNodes.filter(n => n instanceof RedToken) as RedToken[];

            for (const token of tokens) {
                // Add leading trivia
                const leadingTrivia = token.getLeadingTrivia();
                for (const trivia of leadingTrivia) {
                    reconstructed += trivia.text;
                }

                // Add token text
                reconstructed += token.text;

                // Add trailing trivia
                const trailingTrivia = token.getTrailingTrivia();
                for (const trivia of trailingTrivia) {
                    reconstructed += trivia.text;
                }
            }

            expect(reconstructed).toBe(source);
        });

        it('should preserve exact byte-for-byte CRLF sequences', () => {
            // This verifies that \r\n is kept as 2 bytes, not normalized to \n
            const source = 'a\r\nb\r\nc';
            const tree = SyntaxTree.parse(source);

            let reconstructed = '';
            const allNodes = tree.getRoot().getDescendants();
            const tokens = allNodes.filter(n => n instanceof RedToken) as RedToken[];

            for (const token of tokens) {
                const leadingTrivia = token.getLeadingTrivia();
                for (const trivia of leadingTrivia) {
                    reconstructed += trivia.text;
                }
                reconstructed += token.text;
                const trailingTrivia = token.getTrailingTrivia();
                for (const trivia of trailingTrivia) {
                    reconstructed += trivia.text;
                }
            }

            // Verify exact match including CRLF
            expect(reconstructed).toBe(source);
            expect(reconstructed.indexOf('\r\n')).toBeGreaterThanOrEqual(0);
            expect(reconstructed.split('\r\n').length).toBe(source.split('\r\n').length);
        });
    });
});
