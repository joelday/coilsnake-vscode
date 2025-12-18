/**
 * Integration tests for semantic analysis with real-world scenarios
 */

import { SyntaxTree } from './syntaxTree';
import { SymbolKind, Symbol } from './semantic/symbol';
import { SemanticDiagnostic } from './semantic/binder';
import { SyntaxKind } from './syntax/syntaxKind';

describe('Semantic Analysis Integration', () => {
    describe('Command Parameters', () => {
        it('should resolve parameter references in simple command', () => {
            const source = `
                command greet(name) {
                    name
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve multiple parameters', () => {
            const source = `
                command add(x, y) {
                    x
                    y
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve parameters in nested scopes', () => {
            const source = `
                command process(value) {
                    {
                        value
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve parameters in conditional expressions', () => {
            const source = `
                command check(flag_num) {
                    if flag flag_num {
                        flag_num
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Module Imports and Qualified Names', () => {
        it('should accept qualified names when module is imported', () => {
            const source = `
                import std
                
                command test() {
                    std.wait()
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should error on qualified names when module is not imported', () => {
            const source = `
                command test() {
                    std.wait()
                }
            `;
            // No module resolver - std won't be available
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            // Should get error about unknown module std
            // (Module symbol was never created because no import statement)
            expect(diagnostics.length).toBeGreaterThan(0);
            const hasModuleError = diagnostics.some((d: SemanticDiagnostic) =>
                d.message.includes('Unknown module') || d.message.includes('std')
            );
            expect(hasModuleError).toBe(true);
        });

        it('should allow multiple module imports with resolver', () => {
            // Create fake imported modules
            const stdTree = SyntaxTree.parse('command wait() { }');
            const gameTree = SyntaxTree.parse('command save() { }');

            const moduleResolver = (name: string) => {
                if (name === 'std') {
                    return { name: 'std', filePath: 'std.ccs', tree: stdTree, imports: [], dependencies: [] };
                }
                if (name === 'game') {
                    return { name: 'game', filePath: 'game.ccs', tree: gameTree, imports: [], dependencies: [] };
                }
                return undefined;
            };

            const source = `
                import std
                import game
                
                command test() {
                    wait()
                    save()
                }
            `;
            const tree = SyntaxTree.parse(source, moduleResolver);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Complex Real-World Scenarios', () => {
        it('should handle std.ccs-style command definition with string template', () => {
            const source = `
                command set(num) "[04 {short num}]"
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            // Should have no semantic errors (parameter 'num' is used in template)
            expect(diagnostics).toHaveLength(0);
        });

        it('should handle command calling another command with parameters', () => {
            const source = `
                command helper(x) {
                    x
                }
                
                command main(value) {
                    helper(value)
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        it('should handle std.ccs-style command with nested conditionals', () => {
            const source = `
                command toggle(num) {
                    if isset(num) {
                        unset(num)
                    } else {
                        set(num)
                    }
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            // isset, unset, and set are undefined (not imported), but num should resolve
            const undefinedIdentifiers = diagnostics.filter((d: SemanticDiagnostic) =>
                d.message.includes('Undefined')
            );

            // Should have 3 undefined command errors (isset, unset, set)
            // but NOT an undefined identifier error for 'num'
            expect(undefinedIdentifiers.every((d: SemanticDiagnostic) => !d.message.includes('num'))).toBe(true);
        });

        it('should handle constants visible across command scopes', () => {
            const source = `
                define MAX_ITEMS = 100
                
                command check(item_id) {
                    if item_id {
                        MAX_ITEMS
                    }
                }
                
                command process() {
                    MAX_ITEMS
                }
            `;
            const tree = SyntaxTree.parse(source);
            const diagnostics = tree.getSemanticDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Symbol Table Integration', () => {
        it('should correctly classify all symbol types', () => {
            const source = `
                import std
                define CONSTANT = 42
                
                command myCommand(param1, param2) {
                    param1
                }
                
                myLabel:
            `;
            const tree = SyntaxTree.parse(source);
            const symbols = tree.getSymbolTable();

            const allSymbols = symbols.getAllSymbols();

            const modules = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Module);
            const constants = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Constant);
            const commands = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Command);
            const parameters = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Parameter);
            const labels = allSymbols.filter((s: Symbol) => s.kind === SymbolKind.Label);

            // Module symbols are created even without resolver (just can't import actual symbols)
            expect(modules.length).toBeGreaterThanOrEqual(1);
            expect(constants).toHaveLength(1);
            expect(commands).toHaveLength(1);
            expect(parameters).toHaveLength(2);
            expect(labels).toHaveLength(1);
        });

        it('should track symbol usage correctly', () => {
            const source = `
                define USED = 1
                define UNUSED = 2
                
                command test() {
                    USED
                }
            `;
            const tree = SyntaxTree.parse(source);
            const symbols = tree.getSymbolTable();

            const usedSymbol = symbols.getAll('USED')[0];
            const unusedSymbol = symbols.getAll('UNUSED')[0];

            expect(usedSymbol.isUsed).toBe(true);
            expect(unusedSymbol.isUsed).toBe(false);
        });
    });
});
