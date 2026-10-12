/**
 * Integration tests for Parser against test fixtures
 */

import { Parser } from '../parser';
import { SyntaxKind } from '../syntax/syntaxKind';
import { DiagnosticSeverity, GreenSourceFile } from '../syntax/types';
import { SystemTestHarness } from './systemTestHarness';

describe('Parser Fixture Integration', () => {
    const harness = new SystemTestHarness();

    function parseFixture(name: string): { tree: GreenSourceFile; diagnostics: readonly unknown[] } {
        const fixture = harness.loadFixture(name);
        const parser = new Parser(fixture.content);
        const tree = parser.parseSourceFile();
        return { tree, diagnostics: parser.getDiagnostics() };
    }

    describe('Fixture scanning', () => {
        const fixtures = harness.loadAllFixtures();

        it('should parse all fixtures without crashing', () => {
            fixtures.forEach(({ name: _name, content }) => {
                expect(() => {
                    const parser = new Parser(content);
                    const tree = parser.parseSourceFile();
                    expect(tree.kind).toBe(SyntaxKind.SourceFile);
                    expect(tree.endOfFileToken.kind).toBe(SyntaxKind.EndOfFileToken);
                }).not.toThrow();
            });
        });

        it('should produce valid syntax trees for all fixtures', () => {
            fixtures.forEach(({ name: _name, content }) => {
                const parser = new Parser(content);
                const tree = parser.parseSourceFile();
                
                // Every tree should have root and EOF
                expect(tree.kind).toBe(SyntaxKind.SourceFile);
                expect(tree.endOfFileToken).toBeDefined();
                expect(tree.statements).toBeDefined();
                
                // Width should be calculated
                expect(tree.fullWidth).toBeGreaterThanOrEqual(0);
            });
        });

        it('should parse statements correctly for all fixtures', () => {
            fixtures.forEach(({ name: _name, content }) => {
                const parser = new Parser(content);
                const tree = parser.parseSourceFile();
                
                // Should have at least some statements (except empty fixture)
                if (content.trim().length > 0) {
                    expect(tree.statements.length).toBeGreaterThan(0);
                }
                
                // All statements should have valid kinds
                tree.statements.forEach(stmt => {
                    expect(SyntaxKind.isStatement(stmt.kind)).toBe(true);
                });
            });
        });
    });

    describe('01-literals.ccs', () => {
        it('should parse define statements', () => {
            const { tree } = parseFixture('01-literals.ccs');
            
            const defines = tree.statements.filter(s => 
                s.kind === SyntaxKind.ConstantDeclaration
            );
            expect(defines.length).toBeGreaterThan(0);
            
            // Check first define
            const firstDefine = defines[0];
            if (firstDefine && firstDefine.kind === SyntaxKind.ConstantDeclaration) {
                expect(firstDefine.defineKeyword.kind).toBe(SyntaxKind.DefineKeyword);
                expect(firstDefine.identifier.kind).toBe(SyntaxKind.Identifier);
                expect(firstDefine.equals.kind).toBe(SyntaxKind.EqualsToken);
                expect(firstDefine.value).toBeDefined();
            }
        });

        it('should parse numeric and hex literals', () => {
            const { tree } = parseFixture('01-literals.ccs');
            
            // Should have numeric literal expressions
            const hasNumericLiterals = tree.statements.some(stmt => {
                if (stmt.kind === SyntaxKind.ConstantDeclaration) {
                    return stmt.value.kind === SyntaxKind.NumericLiteralExpression;
                }
                return false;
            });
            expect(hasNumericLiterals).toBe(true);
        });
    });

    describe('04-conditionals.ccs', () => {
        it('should parse if statements', () => {
            const { tree } = parseFixture('04-conditionals.ccs');
            
            const ifStatements = tree.statements.filter(s => 
                s.kind === SyntaxKind.IfStatement
            );
            expect(ifStatements.length).toBeGreaterThan(0);
        });

        it('should parse if statement structure correctly', () => {
            const { tree } = parseFixture('04-conditionals.ccs');
            
            const ifStmt = tree.statements.find(s => 
                s.kind === SyntaxKind.IfStatement
            );
            
            if (ifStmt && ifStmt.kind === SyntaxKind.IfStatement) {
                expect(ifStmt.ifKeyword.kind).toBe(SyntaxKind.IfKeyword);
                expect(ifStmt.condition).toBeDefined();
                expect(ifStmt.thenStatement).toBeDefined();
            }
        });

        it('should parse flag expressions in conditions', () => {
            const { tree } = parseFixture('04-conditionals.ccs');
            
            // Should have flag expressions somewhere in the tree
            const hasFlagExpressions = tree.statements.some(stmt => {
                if (stmt.kind === SyntaxKind.IfStatement) {
                    return stmt.condition.kind === SyntaxKind.FlagExpression;
                }
                return false;
            });
            expect(hasFlagExpressions).toBe(true);
        });
    });

    describe('05-menus.ccs', () => {
        it('should parse menu statements', () => {
            const { tree } = parseFixture('05-menus.ccs');
            
            const menus = tree.statements.filter(s => 
                s.kind === SyntaxKind.MenuStatement
            );
            expect(menus.length).toBeGreaterThan(0);
        });

        it('should parse menu options', () => {
            const { tree } = parseFixture('05-menus.ccs');
            
            const menu = tree.statements.find(s => 
                s.kind === SyntaxKind.MenuStatement
            );
            
            if (menu && menu.kind === SyntaxKind.MenuStatement) {
                expect(menu.menuKeyword.kind).toBe(SyntaxKind.MenuKeyword);
                expect(menu.openBrace.kind).toBe(SyntaxKind.OpenBraceToken);
                expect(menu.closeBrace.kind).toBe(SyntaxKind.CloseBraceToken);
                
                // Should have at least one option
                if (menu.options.length > 0) {
                    const option = menu.options[0];
                    expect(option.kind).toBe(SyntaxKind.MenuOption);
                    expect(option.label).toBeDefined();
                    expect(option.colon.kind).toBe(SyntaxKind.ColonToken);
                    expect(option.statement).toBeDefined();
                }
            }
        });
    });

    describe('06-commands.ccs', () => {
        it('should parse command declarations', () => {
            const { tree } = parseFixture('06-commands.ccs');
            
            const commands = tree.statements.filter(s => 
                s.kind === SyntaxKind.CommandDeclaration
            );
            expect(commands.length).toBeGreaterThan(0);
        });

        it('should parse command structure correctly', () => {
            const { tree } = parseFixture('06-commands.ccs');
            
            const cmd = tree.statements.find(s => 
                s.kind === SyntaxKind.CommandDeclaration
            );
            
            if (cmd && cmd.kind === SyntaxKind.CommandDeclaration) {
                expect(cmd.commandKeyword.kind).toBe(SyntaxKind.CommandKeyword);
                expect(cmd.identifier.kind).toBe(SyntaxKind.Identifier);
                expect(cmd.body).toBeDefined();
            }
        });

        it('should parse call expressions', () => {
            const { tree } = parseFixture('06-commands.ccs');
            
            // Should have call expressions in the tree
            function hasCallExpression(tree: GreenSourceFile): boolean {
                for (const stmt of tree.statements) {
                    if (stmt.kind === SyntaxKind.CommandDeclaration) {
                        // Check body for expression statements with calls
                        if (stmt.body.kind === SyntaxKind.BlockStatement) {
                            for (const bodyStmt of stmt.body.statements) {
                                if (bodyStmt.kind === SyntaxKind.ExpressionStatement) {
                                    if (bodyStmt.expression.kind === SyntaxKind.CallExpression) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
                return false;
            }
            
            expect(hasCallExpression(tree)).toBe(true);
        });
    });

    describe('07-rom-access.ccs', () => {
        it('should parse ROM write statements', () => {
            const { tree } = parseFixture('07-rom-access.ccs');
            
            const romWrites = tree.statements.filter(s => 
                s.kind === SyntaxKind.ROMWriteStatement
            );
            expect(romWrites.length).toBeGreaterThan(0);
        });

        it('should parse ROM table write statements', () => {
            const { tree } = parseFixture('07-rom-access.ccs');
            
            const romTblWrites = tree.statements.filter(s => 
                s.kind === SyntaxKind.ROMTableWriteStatement
            );
            expect(romTblWrites.length).toBeGreaterThan(0);
        });

        it('should parse ROM write structure correctly', () => {
            const { tree } = parseFixture('07-rom-access.ccs');
            
            const rom = tree.statements.find(s => 
                s.kind === SyntaxKind.ROMWriteStatement
            );
            
            if (rom && rom.kind === SyntaxKind.ROMWriteStatement) {
                expect(rom.romKeyword.kind).toBe(SyntaxKind.ROMKeyword);
                expect(rom.openBracket.kind).toBe(SyntaxKind.OpenBracketToken);
                expect(rom.address).toBeDefined();
                expect(rom.closeBracket.kind).toBe(SyntaxKind.CloseBracketToken);
                expect(rom.equals.kind).toBe(SyntaxKind.EqualsToken);
                expect(rom.value).toBeDefined();
            }
        });
    });

    describe('08-array-access.ccs', () => {
        it('should parse array access expressions', () => {
            const { tree } = parseFixture('08-array-access.ccs');
            
            // Should have array access expressions
            function hasArrayAccess(tree: GreenSourceFile): boolean {
                for (const stmt of tree.statements) {
                    if (stmt.kind === SyntaxKind.ExpressionStatement) {
                        if (stmt.expression.kind === SyntaxKind.ArrayAccessExpression) {
                            return true;
                        }
                    } else if (stmt.kind === SyntaxKind.ConstantDeclaration) {
                        if (stmt.value.kind === SyntaxKind.ArrayAccessExpression) {
                            return true;
                        }
                    }
                }
                return false;
            }
            
            expect(hasArrayAccess(tree)).toBe(true);
        });
    });

    describe('11-qualified-names.ccs', () => {
        it('should parse qualified names', () => {
            const { tree } = parseFixture('11-qualified-names.ccs');
            
            // Should have qualified name expressions
            function hasQualifiedName(tree: GreenSourceFile): boolean {
                for (const stmt of tree.statements) {
                    if (stmt.kind === SyntaxKind.ExpressionStatement) {
                        if (stmt.expression.kind === SyntaxKind.QualifiedNameExpression) {
                            return true;
                        } else if (stmt.expression.kind === SyntaxKind.CallExpression) {
                            if (stmt.expression.target.kind === SyntaxKind.QualifiedNameExpression) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            }
            
            expect(hasQualifiedName(tree)).toBe(true);
        });
    });

    describe('12-comprehensive.ccs', () => {
        it('should parse comprehensive fixture with many statements', () => {
            const { tree } = parseFixture('12-comprehensive.ccs');
            
            // Should have many statements
            expect(tree.statements.length).toBeGreaterThan(10);
        });

        it('should parse all statement types', () => {
            const { tree } = parseFixture('12-comprehensive.ccs');
            
            const kinds = new Set(tree.statements.map(s => s.kind));
            
            // Should have variety of statement kinds
            expect(kinds.size).toBeGreaterThan(3);
            
            // Should have key statement types
            expect(kinds.has(SyntaxKind.ConstantDeclaration) || 
                   kinds.has(SyntaxKind.CommandDeclaration) ||
                   kinds.has(SyntaxKind.IfStatement) ||
                   kinds.has(SyntaxKind.LabelDeclaration)).toBe(true);
        });

        it('should parse with minimal errors for valid code', () => {
            const { diagnostics } = parseFixture('12-comprehensive.ccs');
            
            // Count actual errors (not warnings)
            const errors = diagnostics.filter((d: unknown) => {
                const diag = d as { severity: DiagnosticSeverity };
                return diag.severity === DiagnosticSeverity.Error;
            });
            
            // Should have very few errors for comprehensive valid fixture
            // (Allow some in case fixture has intentional test cases)
            expect(errors.length).toBeLessThan(5);
        });
    });

    describe('Error handling', () => {
        it('should handle invalid syntax gracefully', () => {
            expect(() => {
                const parser = new Parser('@@@ invalid @@@');
                parser.parseSourceFile();
            }).not.toThrow();
        });

        it('should report diagnostics for invalid syntax', () => {
            const parser = new Parser('@@@ invalid @@@');
            parser.parseSourceFile();
            const diagnostics = parser.getDiagnostics();
            
            expect(diagnostics.length).toBeGreaterThan(0);
        });

        it('should recover and continue parsing after errors', () => {
            const parser = new Parser('@@@@\ndefine x = 1\n@@@@\ndefine y = 2');
            const tree = parser.parseSourceFile();
            
            // Should still parse valid statements
            const defines = tree.statements.filter(s => 
                s.kind === SyntaxKind.ConstantDeclaration
            );
            expect(defines.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Tree structure validation', () => {
        it('should maintain parent-child relationships in width', () => {
            const { tree } = parseFixture('01-literals.ccs');
            
            // Parent width should equal sum of children widths
            function validateWidth(node: unknown): boolean {
                const n = node as { children?: readonly { width: number }[]; width: number };
                if (!n.children || n.children.length === 0) {
                    return true;
                }
                
                const childrenWidth = n.children.reduce((sum: number, child: { width: number }) => 
                    sum + (child.width || 0), 0
                );
                
                if (n.width !== childrenWidth) {
                    return false;
                }
                
                // Recursively validate children
                return n.children.every((child: unknown) => validateWidth(child));
            }
            
            expect(validateWidth(tree)).toBe(true);
        });

        it('should have consistent node structure', () => {
            const { tree } = parseFixture('12-comprehensive.ccs');
            
            // All nodes should have kind and width
            function validateNode(node: unknown): boolean {
                const n = node as { kind?: number; width?: number; children?: readonly unknown[] };
                if (!n) return false;
                if (typeof n.kind !== 'number') return false;
                if (typeof n.width !== 'number') return false;
                
                // Recursively validate children if they exist
                if (n.children) {
                    return n.children.every((child: unknown) => validateNode(child));
                }
                
                return true;
            }
            
            expect(validateNode(tree)).toBe(true);
        });
    });
});
