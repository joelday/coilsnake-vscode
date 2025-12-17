/**
 * Tests for semantic analysis - Symbol tables, scopes, type checking, and name binding
 */

import { SyntaxTree } from './syntaxTree';
import { SymbolKind, Symbol } from './semantic/symbol';
import { TypeKind } from './semantic/types';

describe('Semantic Analysis', () => {
    describe('Symbol Table', () => {
        describe('Constant Declarations', () => {
            it('should create symbol for constant declaration', () => {
                const source = 'define myConst = 42';
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const allSymbols = symbols.getAllSymbols();
                expect(allSymbols).toHaveLength(1);
                expect(allSymbols[0].name).toBe('myConst');
                expect(allSymbols[0].kind).toBe(SymbolKind.Constant);
                expect(allSymbols[0].type.kind).toBe(TypeKind.NumericLiteral);
            });

            it('should detect duplicate constant declarations', () => {
                const source = `
                    define x = 1
                    define x = 2
                `;
                const tree = SyntaxTree.parse(source);
                const diagnostics = tree.getSemanticDiagnostics();

                expect(diagnostics.length).toBeGreaterThan(0);
                expect(diagnostics[0].message).toContain('already declared');
            });

            it('should infer type from value', () => {
                const source = 'define str = "hello"';
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const symbol = symbols.getAll('str')[0];
                expect(symbol.type.kind).toBe(TypeKind.String);
            });
        });

        describe('Command Declarations', () => {
            it('should create symbol for command', () => {
                const source = 'command myCommand() { }';
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const allSymbols = symbols.getAllSymbols();
                const commandSymbol = allSymbols.find((s: Symbol) => s.kind === SymbolKind.Command);
                expect(commandSymbol).toBeDefined();
                expect(commandSymbol!.name).toBe('myCommand');
                expect(commandSymbol!.type.kind).toBe(TypeKind.Void);
            });

            it('should create symbols for parameters', () => {
                const source = 'command test(param1, param2) { }';
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const commandSymbol = symbols.getAll('test')[0];
                expect(commandSymbol.parameters).toHaveLength(2);
                expect(commandSymbol.parameters![0].name).toBe('param1');
                expect(commandSymbol.parameters![1].name).toBe('param2');
            });

            it('should create separate scope for command body', () => {
                const source = `
                    define global = 1
                    command test() {
                        define local = 2
                    }
                `;
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const globalConst = symbols.getAll('global')[0];
                const localConst = symbols.getAll('local')[0];

                expect(globalConst.scopeId).not.toBe(localConst.scopeId);
            });
        });

        describe('Label Declarations', () => {
            it('should create symbol for label', () => {
                const source = 'myLabel:';
                const tree = SyntaxTree.parse(source);
                const symbols = tree.getSymbolTable();

                const labelSymbol = symbols.getAll('myLabel')[0];
                expect(labelSymbol).toBeDefined();
                expect(labelSymbol.kind).toBe(SymbolKind.Label);
            });
        });
    });

    describe('Scope Management', () => {
        it('should resolve identifier in same scope', () => {
            const source = `
                define x = 1
                command test() {
                    x
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve identifier in parent scope', () => {
            const source = `
                define outer = 1
                command test() {
                    {
                        outer
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should not resolve identifier from child scope', () => {
            const source = `
                command test() {
                    define inner = 1
                }
                inner
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('Undefined identifier');
        });

        it('should handle block scopes correctly', () => {
            const source = `
                {
                    define blockLocal = 1
                }
                blockLocal
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('Undefined identifier');
        });

        it('should handle parameter scope', () => {
            const source = `
                command test(param) {
                    param
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Type Inference', () => {
        it('should infer numeric literal type', () => {
            const source = '42';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.NumericLiteral);
        });

        it('should infer string literal type', () => {
            const source = '"hello"';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.String);
        });

        it('should infer flag type for flag expression', () => {
            const source = 'flag 1';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.Flag);
        });

        it('should infer byte type for byte array access', () => {
            const source = 'byte[0]';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.Byte);
        });

        it('should infer short type for short array access', () => {
            const source = 'short[0]';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.Short);
        });

        it('should infer long type for long array access', () => {
            const source = 'long[0]';
            const tree = SyntaxTree.parse(source);
            const root = tree.getRoot();
            const expr = root.getStatements()[0].getChildren()[0];

            const type = tree.getTypeOf(expr);
            expect(type?.kind).toBe(TypeKind.Long);
        });
    });

    describe('Type Checking', () => {
        it('should check boolean operator operands', () => {
            const source = 'flag 1 and flag 2';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should error on non-flag operand to boolean operator', () => {
            const source = '42 and flag 1';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('Expected flag type');
        });

        it('should check not operator operand', () => {
            const source = 'not flag 1';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should error on non-flag operand to not operator', () => {
            const source = 'not 42';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('Expected flag type');
        });
    });

    describe('Name Binding', () => {
        it('should bind identifier to constant', () => {
            const source = `
                define myConst = 42
                myConst
            `;
            const tree = SyntaxTree.parse(source);
            const symbols = tree.getSymbolTable();
            const constantSymbol = symbols.getAll('myConst')[0];

            const usages = tree.findReferences(constantSymbol);
            expect(usages).toHaveLength(1);
            expect(constantSymbol.isUsed).toBe(true);
        });

        it('should bind identifier to command', () => {
            const source = `
                command test() { }
                test()
            `;
            const tree = SyntaxTree.parse(source);
            const symbols = tree.getSymbolTable();
            const commandSymbol = symbols.getAll('test')[0];

            expect(commandSymbol.isUsed).toBe(true);
        });

        it('should error on undefined identifier', () => {
            const source = 'undefined';
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('Undefined identifier');
        });

        it('should error on calling non-command', () => {
            const source = `
                define notACommand = 42
                notACommand()
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].message).toContain('not a command');
        });
    });

    describe('Reference Finding', () => {
        it('should find all references to a symbol', () => {
            const source = `
                define x = 1
                x
                x
                x
            `;
            const tree = SyntaxTree.parse(source);
            const symbols = tree.getSymbolTable();
            const symbol = symbols.getAll('x')[0];

            const refs = tree.findReferences(symbol);
            expect(refs).toHaveLength(3);
        });

        it('should find all usages (declaration + references)', () => {
            const source = `
                define x = 1
                x
                x
            `;
            const tree = SyntaxTree.parse(source);
            const usages = tree.findUsages('x');

            expect(usages).toHaveLength(3); // 1 declaration + 2 references
        });
    });

    describe('Integration Tests', () => {
        it('should analyze complex program', () => {
            const source = `
                define MAX = 100
                
                command process(value) {
                    if flag 1 {
                        value
                    }
                }
                
                start:
                process(MAX)
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();
            const symbols = tree.getSymbolTable();

            // Should have no errors
            expect(diagnostics).toHaveLength(0);

            // Should have correct symbols
            const allSymbols = symbols.getAllSymbols();
            const constantSymbols = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Constant);
            const commandSymbols = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Command);
            const labelSymbols = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Label);
            const paramSymbols = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Parameter);

            expect(constantSymbols).toHaveLength(1);
            expect(commandSymbols).toHaveLength(1);
            expect(labelSymbols).toHaveLength(1);
            expect(paramSymbols).toHaveLength(1);

            // MAX should be used
            const maxSymbol = symbols.getAll('MAX')[0];
            expect(maxSymbol.isUsed).toBe(true);
        });

        it('should handle nested scopes', () => {
            const source = `
                define outer = 1
                
                command test() {
                    define inner = 2
                    {
                        define nested = 3
                        outer
                        inner
                        nested
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should get statistics with semantic info', () => {
            const source = `
                define x = 1
                command test() {
                    x
                }
            `;
            const tree = SyntaxTree.parse(source);
            const stats = tree.getStatistics();

            expect(stats.totalSymbols).toBeGreaterThan(0);
            expect(stats.totalSemanticDiagnostics).toBe(0);
        });
    });
});
