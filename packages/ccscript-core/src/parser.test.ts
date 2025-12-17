/**
 * Unit tests for Parser
 */

import { Parser } from './parser';
import { SyntaxKind } from './syntax/syntaxKind';
import { GreenSourceFile, DiagnosticSeverity } from './syntax/types';

describe('Parser', () => {
    function parse(source: string): GreenSourceFile {
        const parser = new Parser(source);
        return parser.parseSourceFile();
    }

    function parseWithDiagnostics(source: string) {
        const parser = new Parser(source);
        const tree = parser.parseSourceFile();
        return { tree, diagnostics: parser.getDiagnostics() };
    }

    describe('Basic parsing', () => {
        it('should parse empty source', () => {
            const tree = parse('');
            expect(tree.kind).toBe(SyntaxKind.SourceFile);
            expect(tree.statements).toHaveLength(0);
            expect(tree.endOfFileToken.kind).toBe(SyntaxKind.EndOfFileToken);
        });

        it('should parse source with only comments', () => {
            const tree = parse('// Just a comment\n/* Block comment */');
            expect(tree.kind).toBe(SyntaxKind.SourceFile);
            expect(tree.statements).toHaveLength(0);
        });
    });

    describe('Label declarations', () => {
        it('should parse simple label', () => {
            const tree = parse('myLabel:');
            expect(tree.statements).toHaveLength(1);
            const label = tree.statements[0];
            expect(label.kind).toBe(SyntaxKind.LabelDeclaration);
            if (label.kind === SyntaxKind.LabelDeclaration) {
                expect(label.identifier.text).toBe('myLabel');
                expect(label.colon.kind).toBe(SyntaxKind.ColonToken);
            }
        });

        it('should parse multiple labels', () => {
            const tree = parse('label1:\nlabel2:\nlabel3:');
            expect(tree.statements).toHaveLength(3);
            tree.statements.forEach(stmt => {
                expect(stmt.kind).toBe(SyntaxKind.LabelDeclaration);
            });
        });
    });

    describe('Constant declarations', () => {
        it('should parse define with numeric value', () => {
            const tree = parse('define foo = 42');
            expect(tree.statements).toHaveLength(1);
            const def = tree.statements[0];
            expect(def.kind).toBe(SyntaxKind.ConstantDeclaration);
            if (def.kind === SyntaxKind.ConstantDeclaration) {
                expect(def.defineKeyword.kind).toBe(SyntaxKind.DefineKeyword);
                expect(def.identifier.text).toBe('foo');
                expect(def.equals.kind).toBe(SyntaxKind.EqualsToken);
                expect(def.value.kind).toBe(SyntaxKind.NumericLiteralExpression);
            }
        });

        it('should parse define with hex value', () => {
            const tree = parse('define MAX = 0xFF');
            const def = tree.statements[0];
            expect(def.kind).toBe(SyntaxKind.ConstantDeclaration);
            if (def.kind === SyntaxKind.ConstantDeclaration) {
                expect(def.value.kind).toBe(SyntaxKind.NumericLiteralExpression);
            }
        });

        it('should parse define with expression', () => {
            const tree = parse('define total = a + b');
            const def = tree.statements[0];
            expect(def.kind).toBe(SyntaxKind.ConstantDeclaration);
            if (def.kind === SyntaxKind.ConstantDeclaration) {
                expect(def.value.kind).toBe(SyntaxKind.BinaryExpression);
            }
        });
    });

    describe('Command declarations', () => {
        it('should parse command without parameters', () => {
            const tree = parse('command myCommand { }');
            const cmd = tree.statements[0];
            expect(cmd.kind).toBe(SyntaxKind.CommandDeclaration);
            if (cmd.kind === SyntaxKind.CommandDeclaration) {
                expect(cmd.commandKeyword.kind).toBe(SyntaxKind.CommandKeyword);
                expect(cmd.identifier.text).toBe('myCommand');
                expect(cmd.parameterList).toBeUndefined();
                expect(cmd.body.kind).toBe(SyntaxKind.BlockStatement);
            }
        });

        it('should parse command with parameters', () => {
            const tree = parse('command process(x, y, z) { }');
            const cmd = tree.statements[0];
            expect(cmd.kind).toBe(SyntaxKind.CommandDeclaration);
            if (cmd.kind === SyntaxKind.CommandDeclaration) {
                expect(cmd.parameterList).toBeDefined();
                expect(cmd.parameterList?.parameters).toHaveLength(3);
                if (cmd.parameterList) {
                    expect(cmd.parameterList.parameters[0]?.text).toBe('x');
                    expect(cmd.parameterList.parameters[1]?.text).toBe('y');
                    expect(cmd.parameterList.parameters[2]?.text).toBe('z');
                }
            }
        });

        it('should parse command with body statement', () => {
            const tree = parse('command test { define x = 1 }');
            const cmd = tree.statements[0];
            expect(cmd.kind).toBe(SyntaxKind.CommandDeclaration);
            if (cmd.kind === SyntaxKind.CommandDeclaration) {
                expect(cmd.body.kind).toBe(SyntaxKind.BlockStatement);
                if (cmd.body.kind === SyntaxKind.BlockStatement) {
                    expect(cmd.body.statements).toHaveLength(1);
                }
            }
        });
    });

    describe('If statements', () => {
        it('should parse if without else', () => {
            const tree = parse('if x { }');
            const ifStmt = tree.statements[0];
            expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);
            if (ifStmt.kind === SyntaxKind.IfStatement) {
                expect(ifStmt.ifKeyword.kind).toBe(SyntaxKind.IfKeyword);
                expect(ifStmt.condition.kind).toBe(SyntaxKind.IdentifierExpression);
                expect(ifStmt.thenStatement.kind).toBe(SyntaxKind.BlockStatement);
                expect(ifStmt.elseKeyword).toBeUndefined();
                expect(ifStmt.elseStatement).toBeUndefined();
            }
        });

        it('should parse if with else', () => {
            const tree = parse('if x { } else { }');
            const ifStmt = tree.statements[0];
            expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);
            if (ifStmt.kind === SyntaxKind.IfStatement) {
                expect(ifStmt.elseKeyword).toBeDefined();
                expect(ifStmt.elseStatement).toBeDefined();
                expect(ifStmt.elseStatement?.kind).toBe(SyntaxKind.BlockStatement);
            }
        });

        it('should parse nested if', () => {
            const tree = parse('if x if y { }');
            const ifStmt = tree.statements[0];
            expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);
            if (ifStmt.kind === SyntaxKind.IfStatement) {
                expect(ifStmt.thenStatement.kind).toBe(SyntaxKind.IfStatement);
            }
        });

        it('should parse if-else-if chain', () => {
            const tree = parse('if a { } else if b { } else { }');
            const ifStmt = tree.statements[0];
            expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);
            if (ifStmt.kind === SyntaxKind.IfStatement) {
                expect(ifStmt.elseStatement?.kind).toBe(SyntaxKind.IfStatement);
            }
        });
    });

    describe('Menu statements', () => {
        it('should parse empty menu', () => {
            const tree = parse('menu { }');
            const menu = tree.statements[0];
            expect(menu.kind).toBe(SyntaxKind.MenuStatement);
            if (menu.kind === SyntaxKind.MenuStatement) {
                expect(menu.menuKeyword.kind).toBe(SyntaxKind.MenuKeyword);
                expect(menu.options).toHaveLength(0);
            }
        });

        it('should parse menu with columns', () => {
            const tree = parse('menu 2 { }');
            const menu = tree.statements[0];
            expect(menu.kind).toBe(SyntaxKind.MenuStatement);
            if (menu.kind === SyntaxKind.MenuStatement) {
                expect(menu.columns).toBeDefined();
                expect(menu.columns?.text).toBe('2');
            }
        });

        it('should parse menu with options', () => {
            const tree = parse('menu { "Option 1": { } "Option 2": { } }');
            const menu = tree.statements[0];
            expect(menu.kind).toBe(SyntaxKind.MenuStatement);
            if (menu.kind === SyntaxKind.MenuStatement) {
                expect(menu.options).toHaveLength(2);
                expect(menu.options[0]?.kind).toBe(SyntaxKind.MenuOption);
            }
        });

        it('should parse menu with default option', () => {
            const tree = parse('menu { default "Default": { } }');
            const menu = tree.statements[0];
            expect(menu.kind).toBe(SyntaxKind.MenuStatement);
            if (menu.kind === SyntaxKind.MenuStatement) {
                expect(menu.options).toHaveLength(1);
                const option = menu.options[0];
                if (option) {
                    expect(option.defaultKeyword).toBeDefined();
                }
            }
        });
    });

    describe('ROM statements', () => {
        it('should parse ROM write', () => {
            const tree = parse('rom[0x1000] = 42');
            const rom = tree.statements[0];
            expect(rom.kind).toBe(SyntaxKind.ROMWriteStatement);
            if (rom.kind === SyntaxKind.ROMWriteStatement) {
                expect(rom.romKeyword.kind).toBe(SyntaxKind.ROMKeyword);
                expect(rom.address.kind).toBe(SyntaxKind.NumericLiteralExpression);
                expect(rom.value.kind).toBe(SyntaxKind.NumericLiteralExpression);
            }
        });

        it('should parse ROM table write', () => {
            const tree = parse('romtbl[base, 4, index] = value');
            const romtbl = tree.statements[0];
            expect(romtbl.kind).toBe(SyntaxKind.ROMTableWriteStatement);
            if (romtbl.kind === SyntaxKind.ROMTableWriteStatement) {
                expect(romtbl.romtblKeyword.kind).toBe(SyntaxKind.ROMTBLKeyword);
                expect(romtbl.base.kind).toBe(SyntaxKind.IdentifierExpression);
                expect(romtbl.size.kind).toBe(SyntaxKind.NumericLiteralExpression);
                expect(romtbl.index.kind).toBe(SyntaxKind.IdentifierExpression);
            }
        });
    });

    describe('Block statements', () => {
        it('should parse empty block', () => {
            const tree = parse('{ }');
            const block = tree.statements[0];
            expect(block.kind).toBe(SyntaxKind.BlockStatement);
            if (block.kind === SyntaxKind.BlockStatement) {
                expect(block.openBrace.kind).toBe(SyntaxKind.OpenBraceToken);
                expect(block.statements).toHaveLength(0);
                expect(block.closeBrace.kind).toBe(SyntaxKind.CloseBraceToken);
            }
        });

        it('should parse block with statements', () => {
            const tree = parse('{ define x = 1 define y = 2 }');
            const block = tree.statements[0];
            expect(block.kind).toBe(SyntaxKind.BlockStatement);
            if (block.kind === SyntaxKind.BlockStatement) {
                expect(block.statements).toHaveLength(2);
            }
        });

        it('should parse nested blocks', () => {
            const tree = parse('{ { } }');
            const outer = tree.statements[0];
            expect(outer.kind).toBe(SyntaxKind.BlockStatement);
            if (outer.kind === SyntaxKind.BlockStatement) {
                expect(outer.statements).toHaveLength(1);
                expect(outer.statements[0]?.kind).toBe(SyntaxKind.BlockStatement);
            }
        });
    });

    describe('Expressions - Literals', () => {
        it('should parse numeric literal', () => {
            const tree = parse('42');
            const expr = tree.statements[0];
            expect(expr.kind).toBe(SyntaxKind.ExpressionStatement);
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.NumericLiteralExpression);
            }
        });

        it('should parse hex literal', () => {
            const tree = parse('0xFF');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.NumericLiteralExpression);
            }
        });

        it('should parse string literal', () => {
            const tree = parse('"hello"');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.StringLiteralExpression);
            }
        });

        it('should parse boolean literals', () => {
            const tree = parse('true false');
            expect(tree.statements).toHaveLength(2);
            const expr1 = tree.statements[0];
            const expr2 = tree.statements[1];
            if (expr1.kind === SyntaxKind.ExpressionStatement) {
                expect(expr1.expression.kind).toBe(SyntaxKind.BooleanLiteralExpression);
            }
            if (expr2.kind === SyntaxKind.ExpressionStatement) {
                expect(expr2.expression.kind).toBe(SyntaxKind.BooleanLiteralExpression);
            }
        });
    });

    describe('Expressions - Identifiers', () => {
        it('should parse identifier', () => {
            const tree = parse('myVar');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.IdentifierExpression);
                if (expr.expression.kind === SyntaxKind.IdentifierExpression) {
                    expect(expr.expression.identifier.text).toBe('myVar');
                }
            }
        });

        it('should parse qualified name', () => {
            const tree = parse('module.member');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.QualifiedNameExpression);
                if (expr.expression.kind === SyntaxKind.QualifiedNameExpression) {
                    expect(expr.expression.left.text).toBe('module');
                    expect(expr.expression.right.text).toBe('member');
                }
            }
        });
    });

    describe('Expressions - Binary operators', () => {
        it('should parse addition', () => {
            const tree = parse('a + b');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.BinaryExpression);
                if (expr.expression.kind === SyntaxKind.BinaryExpression) {
                    expect(expr.expression.operator.text).toBe('+');
                }
            }
        });

        it('should parse multiplication with higher precedence', () => {
            const tree = parse('a + b * c');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.BinaryExpression);
                if (expr.expression.kind === SyntaxKind.BinaryExpression) {
                    expect(expr.expression.operator.text).toBe('+');
                    expect(expr.expression.right.kind).toBe(SyntaxKind.BinaryExpression);
                }
            }
        });

        it('should parse logical operators', () => {
            const tree = parse('a and b or c');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.BinaryExpression);
                if (expr.expression.kind === SyntaxKind.BinaryExpression) {
                    expect(expr.expression.operator.kind).toBe(SyntaxKind.OrKeyword);
                    expect(expr.expression.left.kind).toBe(SyntaxKind.BinaryExpression);
                }
            }
        });

        it('should respect operator precedence', () => {
            const tree = parse('a or b and c');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.BinaryExpression);
                // 'and' should bind tighter than 'or'
                if (expr.expression.kind === SyntaxKind.BinaryExpression) {
                    expect(expr.expression.operator.kind).toBe(SyntaxKind.OrKeyword);
                    expect(expr.expression.right.kind).toBe(SyntaxKind.BinaryExpression);
                }
            }
        });
    });

    describe('Expressions - Unary operators', () => {
        it('should parse negation', () => {
            const tree = parse('-x');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.UnaryExpression);
                if (expr.expression.kind === SyntaxKind.UnaryExpression) {
                    expect(expr.expression.operator.text).toBe('-');
                }
            }
        });

        it('should parse logical not', () => {
            const tree = parse('not flag');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.UnaryExpression);
                if (expr.expression.kind === SyntaxKind.UnaryExpression) {
                    expect(expr.expression.operator.kind).toBe(SyntaxKind.NotKeyword);
                }
            }
        });

        it('should parse bitwise not', () => {
            const tree = parse('~value');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.UnaryExpression);
            }
        });
    });

    describe('Expressions - Call expressions', () => {
        it('should parse call without arguments', () => {
            const tree = parse('func()');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.CallExpression);
                if (expr.expression.kind === SyntaxKind.CallExpression) {
                    expect(expr.expression.argumentList.arguments).toHaveLength(0);
                }
            }
        });

        it('should parse call with arguments', () => {
            const tree = parse('func(a, b, c)');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.CallExpression);
                if (expr.expression.kind === SyntaxKind.CallExpression) {
                    expect(expr.expression.argumentList.arguments).toHaveLength(3);
                }
            }
        });

        it('should parse nested calls', () => {
            const tree = parse('outer(inner())');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.CallExpression);
                if (expr.expression.kind === SyntaxKind.CallExpression) {
                    expect(expr.expression.argumentList.arguments[0]?.kind).toBe(SyntaxKind.CallExpression);
                }
            }
        });
    });

    describe('Expressions - Special forms', () => {
        it('should parse flag expression', () => {
            const tree = parse('flag 42');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.FlagExpression);
                if (expr.expression.kind === SyntaxKind.FlagExpression) {
                    expect(expr.expression.flagKeyword.kind).toBe(SyntaxKind.FlagKeyword);
                    // operand is now GreenExpression, so check the kind instead
                    expect(expr.expression.operand.kind).toBe(SyntaxKind.NumericLiteralExpression);
                }
            }
        });

        it('should parse byte array access', () => {
            const tree = parse('byte expr');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.ArrayAccessExpression);
                if (expr.expression.kind === SyntaxKind.ArrayAccessExpression) {
                    expect(expr.expression.typeKeyword.kind).toBe(SyntaxKind.ByteKeyword);
                }
            }
        });

        it('should parse short array access with index', () => {
            const tree = parse('short[5] expr');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.ArrayAccessExpression);
                if (expr.expression.kind === SyntaxKind.ArrayAccessExpression) {
                    expect(expr.expression.typeKeyword.kind).toBe(SyntaxKind.ShortKeyword);
                    expect(expr.expression.indexValue?.text).toBe('5');
                }
            }
        });

        it('should parse long array access', () => {
            const tree = parse('long ptr');
            const expr = tree.statements[0];
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.ArrayAccessExpression);
                if (expr.expression.kind === SyntaxKind.ArrayAccessExpression) {
                    expect(expr.expression.typeKeyword.kind).toBe(SyntaxKind.LongKeyword);
                }
            }
        });
    });

    describe('Error recovery', () => {
        it('should recover from missing token', () => {
            const { tree, diagnostics } = parseWithDiagnostics('define foo =');
            expect(tree.statements).toHaveLength(1);
            expect(diagnostics.some(d => d.severity === DiagnosticSeverity.Error)).toBe(true);
        });

        it('should recover from unexpected token', () => {
            const { tree, diagnostics } = parseWithDiagnostics('@@@@');
            expect(tree.statements.length).toBeGreaterThanOrEqual(1);
            expect(diagnostics.length).toBeGreaterThan(0);
        });

        it('should recover from missing close brace', () => {
            const { tree, diagnostics } = parseWithDiagnostics('{ define x = 1');
            expect(tree.statements).toHaveLength(1);
            expect(diagnostics.some(d => d.message.includes('CloseBraceToken'))).toBe(true);
        });

        it('should recover from missing close paren', () => {
            const { tree, diagnostics } = parseWithDiagnostics('func(a, b');
            expect(tree.statements).toHaveLength(1);
            expect(diagnostics.some(d => d.message.includes('CloseParenToken'))).toBe(true);
        });

        it('should recover and continue parsing after error', () => {
            const { tree } = parseWithDiagnostics('@@@@\ndefine x = 1\n@@@@\ndefine y = 2');
            // Should have parsed at least the valid statements
            const validStatements = tree.statements.filter(s =>
                s.kind === SyntaxKind.ConstantDeclaration
            );
            expect(validStatements.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Complex parsing', () => {
        it('should parse complex expression', () => {
            const tree = parse('(a + b) * (c - d)');
            const expr = tree.statements[0];
            expect(expr.kind).toBe(SyntaxKind.ExpressionStatement);
            if (expr.kind === SyntaxKind.ExpressionStatement) {
                expect(expr.expression.kind).toBe(SyntaxKind.BinaryExpression);
            }
        });

        it('should parse command with complex body', () => {
            const source = `
                command test {
                    define x = 1
                    if x {
                        label:
                        rom[0x100] = x
                    }
                }
            `;
            const tree = parse(source);
            expect(tree.statements).toHaveLength(1);
            const cmd = tree.statements[0];
            expect(cmd.kind).toBe(SyntaxKind.CommandDeclaration);
        });

        it('should parse nested control flow', () => {
            const source = `
                if a {
                    if b {
                        menu {
                            "Option": { }
                        }
                    }
                }
            `;
            const tree = parse(source);
            expect(tree.statements).toHaveLength(1);
            const ifStmt = tree.statements[0];
            expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);
        });
    });

    describe('Import statements', () => {
        it('should parse import with identifier', () => {
            const tree = parse('import mymodule');
            expect(tree.statements).toHaveLength(1);
            const stmt = tree.statements[0];
            expect(stmt.kind).toBe(SyntaxKind.ImportStatement);
            if (stmt.kind === SyntaxKind.ImportStatement) {
                expect(stmt.importKeyword.kind).toBe(SyntaxKind.ImportKeyword);
                expect(stmt.path.kind).toBe(SyntaxKind.Identifier);
                expect(stmt.path.text).toBe('mymodule');
            }
        });

        it('should parse import with string literal', () => {
            const tree = parse('import "path/to/file.ccs"');
            expect(tree.statements).toHaveLength(1);
            const stmt = tree.statements[0];
            expect(stmt.kind).toBe(SyntaxKind.ImportStatement);
            if (stmt.kind === SyntaxKind.ImportStatement) {
                expect(stmt.importKeyword.kind).toBe(SyntaxKind.ImportKeyword);
                expect(stmt.path.kind).toBe(SyntaxKind.StringLiteral);
                expect(stmt.path.text).toBe('"path/to/file.ccs"');
            }
        });

        it('should parse multiple imports', () => {
            const source = `
                import std
                import "lib/custom.ccs"
                import mylib
            `;
            const tree = parse(source);
            const imports = tree.statements.filter(s => s.kind === SyntaxKind.ImportStatement);
            expect(imports).toHaveLength(3);
        });
    });
});
