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
            const diagnostics = tree.getAllDiagnostics();

            // Should have a syntax error on line 3 (missing identifier after define)
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = 'span' in syntaxError ? syntaxError.span.start : syntaxError.position;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2); // 0-indexed, so line 3 = index 2
        });

        it('should handle CRLF line endings correctly', () => {
            const source = 'define x = 42\r\ndefine y = 99\r\ndefine =';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            // Should have a syntax error on line 3 (missing identifier after define)
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = 'span' in syntaxError ? syntaxError.span.start : syntaxError.position;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2); // 0-indexed, so line 3 = index 2
        });

        it('should handle mixed line endings', () => {
            const source = 'define x = 42\r\ndefine y = 99\ndefine =';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            // Should still work with mixed endings
            expect(diagnostics.length).toBeGreaterThan(0);
            const syntaxError = diagnostics[0];
            const position = 'span' in syntaxError ? syntaxError.span.start : syntaxError.position;
            const { line } = tree.getLineAndColumn(position);
            expect(line).toBe(2);
        });
    });

    describe('Semantic diagnostics with different line endings', () => {
        it('should position semantic errors correctly with LF', () => {
            const source = 'define x = 42\ncommand test() {\n    y\n}';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            // Should have an undefined identifier error for 'y'
            const undefinedError = diagnostics.find(d => d.message.includes('Undefined identifier'));
            expect(undefinedError).toBeDefined();

            if (undefinedError) {
                const pos = 'span' in undefinedError ? undefinedError.span.start : undefinedError.position;
                const len = 'span' in undefinedError ? undefinedError.span.length : undefinedError.length;
                const { line } = tree.getLineAndColumn(pos);
                expect(line).toBeGreaterThanOrEqual(0); // Line with identifier
                expect(len).toBe(1); // Just the 'y', not the whole line
            }
        });

        it('should position semantic errors correctly with CRLF', () => {
            const source = 'define x = 42\r\ncommand test() {\r\n    y\r\n}';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            // Should have an undefined identifier error for 'y'
            const undefinedError = diagnostics.find(d => d.message.includes('Undefined identifier'));
            expect(undefinedError).toBeDefined();

            if (undefinedError) {
                const position = 'span' in undefinedError ? undefinedError.span.start : undefinedError.position;
                const length = 'span' in undefinedError ? undefinedError.span.length : undefinedError.length;
                const { line } = tree.getLineAndColumn(position);
                expect(line).toBeGreaterThanOrEqual(0); // Line with identifier
                expect(length).toBe(1); // Just the 'y', not the whole line
            }
        });

        it('should not span multiple lines with CRLF', () => {
            const source = 'define x = 42\r\ncommand test() { undefinedFunc() }\r\ndefine y = 99';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            // Should have an undefined command error
            const undefinedError = diagnostics.find(d => d.message.includes('Undefined command'));
            expect(undefinedError).toBeDefined();

            if (undefinedError) {
                // Check that the diagnostic doesn't span to the next line
                const pos = 'span' in undefinedError ? undefinedError.span.start : undefinedError.position;
                const len = 'span' in undefinedError ? undefinedError.span.length : undefinedError.length;
                const startPos = tree.getLineAndColumn(pos);
                const endPos = tree.getLineAndColumn(pos + len);

                expect(startPos.line).toBe(endPos.line); // Should be on same line
                expect(len).toBeLessThan(20); // Reasonable length for identifier
            }
        });

        it('should calculate correct offsets with CRLF throughout file', () => {
            // This tests the actual issue we had
            const source = [
                'define x = 42',
                'define y = x + 1',
                '',
                'command test() {',
                '    undefinedFunc()',
                '}'
            ].join('\r\n');

            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getAllDiagnostics();

            const undefinedError = diagnostics.find(d => d.message.includes('Undefined command'));
            expect(undefinedError).toBeDefined();

            if (undefinedError) {
                const pos = 'span' in undefinedError ? undefinedError.span.start : undefinedError.position;
                const len = 'span' in undefinedError ? undefinedError.span.length : undefinedError.length;
                const { line, column } = tree.getLineAndColumn(pos);
                expect(line).toBeGreaterThanOrEqual(3); // Line with undefinedFunc (should be towards the end)
                expect(column).toBeGreaterThan(0); // Should be indented

                // The diagnostic should only cover the function name
                expect(len).toBe('undefinedFunc'.length);
            }
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
