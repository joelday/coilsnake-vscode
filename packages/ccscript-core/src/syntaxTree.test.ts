/**
 * Unit tests for SyntaxTree
 */

import { SyntaxTree } from './syntaxTree';
import { SyntaxKind } from './syntax/syntaxKind';
import { DiagnosticSeverity } from './syntax/types';
import { RedToken } from './redNode';

describe('SyntaxTree', () => {
    describe('Parsing', () => {
        it('should parse source code', () => {
            const tree = SyntaxTree.parse('define x = 1');
            expect(tree).toBeDefined();
            expect(tree.source).toBe('define x = 1');
        });

        it('should parse empty source', () => {
            const tree = SyntaxTree.parse('');
            expect(tree).toBeDefined();
        });

        it('should parse complex source', () => {
            const source = `
                define x = 1
                command test {
                    if x { }
                }
            `;
            const tree = SyntaxTree.parse(source);
            expect(tree).toBeDefined();
        });
    });

    describe('Root access', () => {
        it('should get root node', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const root = tree.getRoot();
            expect(root).toBeDefined();
            expect(root.kind).toBe(SyntaxKind.SourceFile);
        });

        it('should cache root node', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const root1 = tree.getRoot();
            const root2 = tree.getRoot();
            expect(root1).toBe(root2);
        });

        it('should get green root', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const green = tree.getGreenRoot();
            expect(green).toBeDefined();
            expect(green.kind).toBe(SyntaxKind.SourceFile);
        });
    });

    describe('Diagnostics', () => {
        it('should get diagnostics', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const diagnostics = tree.getDiagnostics();
            expect(Array.isArray(diagnostics)).toBe(true);
        });

        it('should report no errors for valid code', () => {
            const tree = SyntaxTree.parse('define x = 1');
            expect(tree.hasErrors()).toBe(false);
        });

        it('should report errors for invalid code', () => {
            const tree = SyntaxTree.parse('@@@@');
            expect(tree.hasErrors()).toBe(true);
        });

        it('should combine scanner and parser diagnostics', () => {
            const tree = SyntaxTree.parse('/* unterminated\ndefine x =');
            const diagnostics = tree.getDiagnostics();
            expect(diagnostics.length).toBeGreaterThan(0);
        });
    });

    describe('Position queries', () => {
        it('should get node at position', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const node = tree.getNodeAtPosition(0);
            expect(node).toBeDefined();
        });

        it('should get token at position', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const token = tree.getTokenAtPosition(0);
            expect(token).toBeDefined();
            expect(token instanceof RedToken).toBe(true);
        });

        it('should handle position at end of file', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const node = tree.getNodeAtPosition(tree.length);
            expect(node).toBeDefined();
        });
    });

    describe('Statement access', () => {
        it('should get all statements', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const statements = tree.getStatements();
            expect(statements.length).toBeGreaterThanOrEqual(2);
        });

        it('should get empty statements for empty source', () => {
            const tree = SyntaxTree.parse('');
            const statements = tree.getStatements();
            expect(statements.length).toBe(0);
        });
    });

    describe('Token access', () => {
        it('should get all tokens', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const tokens = tree.getTokens();
            expect(tokens.length).toBeGreaterThan(0);
            expect(tokens.every(t => t instanceof RedToken)).toBe(true);
        });

        it('should include EOF token', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const tokens = tree.getTokens();
            const eof = tokens.find(t => t.kind === SyntaxKind.EndOfFileToken);
            expect(eof).toBeDefined();
        });
    });

    describe('Node finding', () => {
        it('should find nodes of specific kind', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const defines = tree.findNodesOfKind(SyntaxKind.ConstantDeclaration);
            expect(defines.length).toBeGreaterThanOrEqual(2);
        });

        it('should find nodes by predicate', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const nodes = tree.findNodes(node => node.kind === SyntaxKind.ConstantDeclaration);
            expect(nodes.length).toBeGreaterThanOrEqual(2);
        });

        it('should return empty array when no matches', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const menus = tree.findNodesOfKind(SyntaxKind.MenuStatement);
            expect(menus.length).toBe(0);
        });
    });

    describe('Text operations', () => {
        it('should get text for node', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const root = tree.getRoot();
            const text = tree.getText(root);
            expect(text).toBe('define x = 1');
        });

        it('should get text range', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const text = tree.getTextRange(0, 6);
            expect(text).toBe('define');
        });

        it('should get source length', () => {
            const tree = SyntaxTree.parse('define x = 1');
            expect(tree.length).toBe(12);
        });
    });

    describe('Line and column', () => {
        it('should get line and column for position', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const loc = tree.getLineAndColumn(0);
            expect(loc.line).toBe(0);
            expect(loc.column).toBe(0);
        });

        it('should handle newlines', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const loc = tree.getLineAndColumn(13);
            expect(loc.line).toBe(1);
            expect(loc.column).toBe(0);
        });

        it('should get position from line and column', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const pos = tree.getPosition(1, 0);
            expect(pos).toBe(13);
        });

        it('should round trip line/column conversion', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const originalPos = 13;
            const loc = tree.getLineAndColumn(originalPos);
            const pos = tree.getPosition(loc.line, loc.column);
            expect(pos).toBe(originalPos);
        });
    });

    describe('Declaration access', () => {
        it('should get labels', () => {
            const tree = SyntaxTree.parse('label1:\nlabel2:');
            const labels = tree.getLabels();
            expect(labels.length).toBeGreaterThanOrEqual(2);
        });

        it('should get constants', () => {
            const tree = SyntaxTree.parse('define x = 1\ndefine y = 2');
            const constants = tree.getConstants();
            expect(constants.length).toBeGreaterThanOrEqual(2);
        });

        it('should get commands', () => {
            const tree = SyntaxTree.parse('command foo { }\ncommand bar { }');
            const commands = tree.getCommands();
            expect(commands.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Identifier operations', () => {
        it('should get all identifiers', () => {
            const tree = SyntaxTree.parse('define x = y');
            const identifiers = tree.getIdentifiers();
            expect(identifiers.length).toBeGreaterThanOrEqual(2);
        });

        it('should find identifier by name', () => {
            const tree = SyntaxTree.parse('define foo = 1');
            const id = tree.findIdentifier('foo');
            expect(id).toBeDefined();
            expect(id?.text).toBe('foo');
        });

        it('should find all identifiers with name', () => {
            const tree = SyntaxTree.parse('define x = 1\nx = 2');
            const ids = tree.findIdentifiers('x');
            expect(ids.length).toBeGreaterThanOrEqual(2);
        });

        it('should return undefined for non-existent identifier', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const id = tree.findIdentifier('nonexistent');
            expect(id).toBeUndefined();
        });
    });

    describe('Validation', () => {
        it('should validate position', () => {
            const tree = SyntaxTree.parse('define x = 1');
            expect(tree.isValidPosition(0)).toBe(true);
            expect(tree.isValidPosition(tree.length)).toBe(true);
            expect(tree.isValidPosition(-1)).toBe(false);
            expect(tree.isValidPosition(tree.length + 1)).toBe(false);
        });
    });

    describe('Statistics', () => {
        it('should get tree statistics', () => {
            const tree = SyntaxTree.parse('define x = 1');
            const stats = tree.getStatistics();
            
            expect(stats.totalNodes).toBeGreaterThan(0);
            expect(stats.totalTokens).toBeGreaterThan(0);
            expect(stats.totalStatements).toBeGreaterThanOrEqual(1);
            expect(stats.sourceLength).toBe(12);
            expect(typeof stats.hasErrors).toBe('boolean');
        });

        it('should report errors in statistics', () => {
            const tree = SyntaxTree.parse('@@@@');
            const stats = tree.getStatistics();
            expect(stats.hasErrors).toBe(true);
            expect(stats.totalDiagnostics).toBeGreaterThan(0);
        });
    });

    describe('Tree updates', () => {
        it('should create new tree on update', () => {
            const tree1 = SyntaxTree.parse('define x = 1');
            const tree2 = SyntaxTree.update(tree1, 'define y = 2');
            
            expect(tree2).not.toBe(tree1);
            expect(tree2.source).toBe('define y = 2');
        });
    });

    describe('Complex scenarios', () => {
        it('should handle nested structures', () => {
            const source = `
                command test {
                    if flag 1 {
                        menu {
                            "Option": { }
                        }
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const commands = tree.getCommands();
            expect(commands.length).toBeGreaterThanOrEqual(1);
        });

        it('should handle expressions', () => {
            const tree = SyntaxTree.parse('define result = a + b * c');
            const tokens = tree.getTokens();
            const identifiers = tree.getIdentifiers();
            expect(tokens.length).toBeGreaterThan(5);
            expect(identifiers.length).toBeGreaterThanOrEqual(3);
        });

        it('should handle comments', () => {
            const source = `
                // Single line comment
                define x = 1
                /* Multi-line
                   comment */
                define y = 2
            `;
            const tree = SyntaxTree.parse(source);
            const constants = tree.getConstants();
            expect(constants.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Template expression positions', () => {
        it.each([
            'define s = "a{ x }b"\ndefine y = 1',
            'define s = "a{  byte x\t}b{ }c{  }d"\ndefine y = 1',
            'define s = "{call( 1 , 2 )} and { short[1] y }"',
        ])('should place every token at its source position: %j', source => {
            const tree = SyntaxTree.parse(source);
            expect(tree.getRoot().fullWidth).toBe(source.length);
            for (const token of tree.getTokens()) {
                expect(source.substr(token.span.start, token.text.length)).toBe(token.text);
            }
        });
    });

    describe('Template expression leftovers', () => {
        it('ignores text after the expression with a warning, as the compiler does', () => {
            const source = 'define s = "{name(1)...} and {byte rows)}"';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getDiagnostics();
            expect(diagnostics.map(d => [d.severity, d.message])).toEqual([
                [DiagnosticSeverity.Warning, "In template expression: Ignored by the compiler: '...' after the expression"],
                [DiagnosticSeverity.Warning, "In template expression: Ignored by the compiler: ')' after the expression"],
            ]);
            expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.start + 1)).toBe('.');
            // The expressions are still there, and positions still line up
            expect(tree.findNodesOfKind(SyntaxKind.StringTemplateExpression)).toHaveLength(2);
            for (const token of tree.getTokens()) {
                expect(source.substr(token.span.start, token.text.length)).toBe(token.text);
            }
        });
    });

    describe('Template expression diagnostics', () => {
        it('should report embedded expression errors at their position in the file', () => {
            const source = 'define a = 1\ndefine s = "text {  a + } more"';
            const tree = SyntaxTree.parse(source);
            const diagnostic = tree.getDiagnostics().find(d => d.message.startsWith('In template expression'));

            expect(diagnostic).toBeDefined();
            const { line } = tree.getLineAndColumn(diagnostic!.span.start);
            expect(line).toBe(1);
            // Within the braces, at or after the start of the expression
            expect(diagnostic!.span.start).toBeGreaterThanOrEqual(source.indexOf('a +'));
            expect(diagnostic!.span.start).toBeLessThanOrEqual(source.indexOf('} more'));
        });
    });
});
