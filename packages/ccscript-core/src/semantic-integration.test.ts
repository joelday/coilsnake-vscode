/**
 * Integration tests for semantic analysis with real-world scenarios
 */

import { Program } from './program';
import { MemoryFileSystem } from './fileSystem';
import { SymbolKind } from './semantic/symbol';

function createProgram(source: string, filePath = '/test.ccs'): Promise<Program> {
    const fs = new MemoryFileSystem();
    fs.addFile(filePath, source);
    const program = new Program({
        fileSystem: fs,
        rootPath: '/',
        includeStdLibs: false,
    });
    return Promise.resolve(program);
}

describe('Semantic Analysis Integration', () => {
    describe('Command Parameters', () => {
        it('should resolve parameter references in simple command', async () => {
            const source = `
                command greet(name) {
                    name
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve multiple parameters', async () => {
            const source = `
                command add(x, y) {
                    x
                    y
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve parameters in nested scopes', async () => {
            const source = `
                command process(value) {
                    {
                        value
                    }
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });

        it('should resolve parameters in conditional expressions', async () => {
            const source = `
                command check(flag_num) {
                    if flag flag_num {
                        flag_num
                    }
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Module Imports and Dependencies', () => {
        it('should resolve imports from sibling files', async () => {
            const fs = new MemoryFileSystem();
            fs.addFile('/lib/helper.ccs', 'command wait() { }');
            fs.addFile('/lib/test.ccs', `
                import "helper.ccs"
                
                command test() {
                    wait()
                }
            `);

            const program = new Program({
                fileSystem: fs,
                rootPath: '/lib',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/lib/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });

        it('should error on undefined imported commands', async () => {
            const source = `
                command test() {
                    wait()
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            // Should get error about undefined command
            expect(diagnostics.length).toBeGreaterThan(0);
            const hasError = diagnostics.some((d) =>
                d.message.includes('Undefined') || d.message.includes('wait')
            );
            expect(hasError).toBe(true);
        });

        it('should allow imports from multiple files', async () => {
            const fs = new MemoryFileSystem();
            fs.addFile('/game/std.ccs', 'command wait() { }');
            fs.addFile('/game/save.ccs', 'command save() { }');
            fs.addFile('/game/test.ccs', `
                import "std.ccs"
                import "save.ccs"
                
                command test() {
                    wait()
                    save()
                }
            `);

            const program = new Program({
                fileSystem: fs,
                rootPath: '/game',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/game/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Complex Real-World Scenarios', () => {
        it('should handle command definition with string template', async () => {
            const source = `
                command set(num) "[04 {short num}]"
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            // Should have no semantic errors (parameter 'num' is used in template)
            expect(diagnostics).toHaveLength(0);
        });

        it('should handle command calling another command with parameters', async () => {
            const source = `
                command helper(x) {
                    x
                }
                
                command main(value) {
                    helper(value)
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });

        it('should handle command with nested conditionals', async () => {
            const source = `
                command isset(num) { num }
                command unset(num) { num }
                command set(num) { num }
                
                command toggle(num) {
                    if isset(num) {
                        unset(num)
                    } else {
                        set(num)
                    }
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            // All commands are defined, num parameter should resolve
            expect(diagnostics).toHaveLength(0);
        });

        it('should handle constants visible across command scopes', async () => {
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
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const diagnostics = module!.binding?.diagnostics || [];

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Symbol Table Integration', () => {
        it('should correctly classify all symbol types', async () => {
            const source = `
                import "std.ccs"
                define CONSTANT = 42
                
                command myCommand(param1, param2) {
                    param1
                }
                
                myLabel:
            `;
            const fs = new MemoryFileSystem();
            fs.addFile('/std.ccs', '');
            fs.addFile('/test.ccs', source);
            const program = new Program({
                fileSystem: fs,
                rootPath: '/',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/test.ccs');
            const symbols = module!.binding!.symbols;
            const allSymbols = symbols.getAllSymbols();

            const constants = allSymbols.filter((s) => s.kind === SymbolKind.Constant);
            const commands = allSymbols.filter((s) => s.kind === SymbolKind.Command);
            const parameters = allSymbols.filter((s) => s.kind === SymbolKind.Parameter);
            const labels = allSymbols.filter((s) => s.kind === SymbolKind.Label);

            expect(constants).toHaveLength(1);
            expect(commands).toHaveLength(1);
            expect(parameters).toHaveLength(2);
            expect(labels).toHaveLength(1);
        });

        it('should track symbol usage correctly', async () => {
            const source = `
                define USED = 1
                define UNUSED = 2
                
                command test() {
                    USED
                }
            `;
            const program = await createProgram(source);
            const module = await program.loadModule('/test.ccs');
            const symbols = module!.binding!.symbols;

            const usedSymbol = symbols.getAll('USED')[0];
            const unusedSymbol = symbols.getAll('UNUSED')[0];

            expect(usedSymbol.isUsed).toBe(true);
            expect(unusedSymbol.isUsed).toBe(false);
        });
    });
});
