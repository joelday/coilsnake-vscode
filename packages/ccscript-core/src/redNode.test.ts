/**
 * Unit tests for RedNode
 */

import { Parser } from './parser';
import { createRedTree, RedNode, RedToken, RedSourceFile } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';

describe('RedNode', () => {
    function parseAndCreateRedTree(source: string): RedSourceFile {
        const parser = new Parser(source);
        const green = parser.parseSourceFile();
        return createRedTree(green);
    }

    describe('Basic properties', () => {
        it('should have correct kind', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.kind).toBe(SyntaxKind.SourceFile);
        });

        it('should have correct position', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.position).toBe(0);
        });

        it('should have correct width', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.width).toBeGreaterThan(0);
        });

        it('should calculate end correctly', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.end).toBe(root.position + root.width);
        });

        it('should return correct span', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const span = root.getSpan();
            expect(span.start).toBe(0);
            expect(span.length).toBe(root.width);
        });
    });

    describe('Children', () => {
        it('should get children', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const children = root.getChildren();
            expect(children.length).toBeGreaterThan(0);
        });

        it('should cache children', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const children1 = root.getChildren();
            const children2 = root.getChildren();
            expect(children1).toBe(children2); // Same array reference
        });

        it('should get child at index', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const child = root.getChildAt(0);
            expect(child).toBeDefined();
        });

        it('should return null for invalid index', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const child = root.getChildAt(999);
            expect(child).toBeNull();
        });

        it('should get child count', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const count = root.getChildCount();
            expect(count).toBeGreaterThan(0);
        });

        it('should get first child', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const first = root.getFirstChild();
            expect(first).toBeDefined();
        });

        it('should get last child', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const last = root.getLastChild();
            expect(last).toBeDefined();
            expect(last?.kind).toBe(SyntaxKind.EndOfFileToken);
        });
    });

    describe('Position-based queries', () => {
        it('should get child at position', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const child = root.getChildAtPosition(0);
            expect(child).toBeDefined();
        });

        it('should get deepest node at position', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const node = root.getNodeAtPosition(0);
            expect(node).toBeDefined();
        });

        it('should check if contains position', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.containsPosition(0)).toBe(true);
            expect(root.containsPosition(root.width + 1)).toBe(false);
        });

        it('should navigate to deepest token', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const deepest = root.getNodeAtPosition(0);
            expect(deepest instanceof RedToken).toBe(true);
        });
    });

    describe('Parent-child relationships', () => {
        it('should have null parent for root', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root.parent).toBeNull();
        });

        it('should have correct parent for children', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const child = root.getFirstChild();
            expect(child?.parent).toBe(root);
        });

        it('should get ancestors', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const deepest = root.getNodeAtPosition(0);
            const ancestors = deepest.getAncestors();
            expect(ancestors.length).toBeGreaterThan(0);
            expect(ancestors[ancestors.length - 1]).toBe(root);
        });

        it('should get ancestor of kind', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const deepest = root.getNodeAtPosition(0);
            const sourceFile = deepest.getAncestorOfKind(SyntaxKind.SourceFile);
            expect(sourceFile).toBe(root);
        });

        it('should check ancestor relationship', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const child = root.getFirstChild();
            if (child) {
                expect(root.isAncestorOf(child)).toBe(true);
                expect(child.isDescendantOf(root)).toBe(true);
            }
        });
    });

    describe('Sibling navigation', () => {
        it('should get previous sibling', () => {
            const root = parseAndCreateRedTree('define x = 1\ndefine y = 2');
            const children = root.getChildren();
            if (children.length > 1) {
                const second = children[1];
                const previous = second?.getPreviousSibling();
                expect(previous).toBe(children[0]);
            }
        });

        it('should get next sibling', () => {
            const root = parseAndCreateRedTree('define x = 1\ndefine y = 2');
            const children = root.getChildren();
            if (children.length > 1) {
                const first = children[0];
                const next = first?.getNextSibling();
                expect(next).toBe(children[1]);
            }
        });

        it('should return null for first node previous sibling', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const first = root.getFirstChild();
            expect(first?.getPreviousSibling()).toBeNull();
        });

        it('should return null for last node next sibling', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const last = root.getLastChild();
            expect(last?.getNextSibling()).toBeNull();
        });
    });

    describe('Tree traversal', () => {
        it('should get all descendants', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const descendants = root.getDescendants();
            expect(descendants.length).toBeGreaterThan(0);
        });

        it('should get all tokens', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const tokens = root.getTokens();
            expect(tokens.length).toBeGreaterThan(0);
            expect(tokens.every(t => t instanceof RedToken)).toBe(true);
        });

        it('should get root from any node', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const deepest = root.getNodeAtPosition(0);
            expect(deepest.getRoot()).toBe(root);
        });
    });

    describe('RedToken', () => {
        it('should create RedToken for token nodes', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const tokens = root.getTokens();
            expect(tokens.length).toBeGreaterThan(0);
        });

        it('should have text property', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const tokens = root.getTokens();
            const defineToken = tokens.find(t => t.kind === SyntaxKind.DefineKeyword);
            expect(defineToken?.text).toBe('define');
        });

        it('should have no children', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const tokens = root.getTokens();
            expect(tokens[0]?.getChildren().length).toBe(0);
        });

        it('should get leading trivia', () => {
            const root = parseAndCreateRedTree('  define x = 1');
            const tokens = root.getTokens();
            const defineToken = tokens.find(t => t.kind === SyntaxKind.DefineKeyword);
            expect(defineToken?.getLeadingTrivia().length).toBeGreaterThan(0);
        });
    });

    describe('RedSourceFile', () => {
        it('should be created for root', () => {
            const root = parseAndCreateRedTree('define x = 1');
            expect(root instanceof RedSourceFile).toBe(true);
        });

        it('should get statements', () => {
            const root = parseAndCreateRedTree('define x = 1\ndefine y = 2');
            const statements = root.getStatements();
            expect(statements.length).toBeGreaterThanOrEqual(2);
        });

        it('should get EOF token', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const eof = root.getEndOfFileToken();
            expect(eof.kind).toBe(SyntaxKind.EndOfFileToken);
        });
    });

    describe('Position consistency', () => {
        it('should have consistent positions across tree', () => {
            const root = parseAndCreateRedTree('define x = 1\ndefine y = 2');
            
            function validatePositions(node: RedNode): boolean {
                const children = node.getChildren();
                let expectedPosition = node.position;
                
                for (const child of children) {
                    if (child.position !== expectedPosition) {
                        return false;
                    }
                    if (!validatePositions(child)) {
                        return false;
                    }
                    expectedPosition += child.width;
                }
                
                return true;
            }
            
            expect(validatePositions(root)).toBe(true);
        });

        it('should have no gaps in positions', () => {
            const root = parseAndCreateRedTree('define x = 1');
            const children = root.getChildren();
            
            for (let i = 1; i < children.length; i++) {
                const prev = children[i - 1];
                const curr = children[i];
                if (prev && curr) {
                    expect(curr.position).toBe(prev.end);
                }
            }
        });
    });

    describe('Complex structures', () => {
        it('should handle nested blocks', () => {
            const root = parseAndCreateRedTree('{ { } }');
            const descendants = root.getDescendants();
            const blocks = descendants.filter(d => d.kind === SyntaxKind.BlockStatement);
            expect(blocks.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle if statements', () => {
            const root = parseAndCreateRedTree('if x { }');
            const ifStmt = root.getStatements()[0];
            expect(ifStmt?.kind).toBe(SyntaxKind.IfStatement);
        });

        it('should navigate complex expressions', () => {
            const root = parseAndCreateRedTree('define x = a + b * c');
            const tokens = root.getTokens();
            expect(tokens.length).toBeGreaterThan(5);
        });
    });
});
