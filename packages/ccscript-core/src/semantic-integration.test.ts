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

    describe('Qualified Names', () => {
        async function load(files: Record<string, string>, entry: string) {
            const fs = new MemoryFileSystem();
            for (const [path, content] of Object.entries(files)) {
                fs.addFile(path, content);
            }
            const program = new Program({ fileSystem: fs, rootPath: '/game', includeStdLibs: false });
            await program.loadModule(entry);
            // Load the other file explicitly too, as the compiler would for a whole project
            for (const path of Object.keys(files)) {
                await program.loadModule(path);
            }
            return program.getModule(entry)!.binding!.diagnostics;
        }

        it('should resolve members of a loaded module that is not imported', async () => {
            const diagnostics = await load({
                '/game/a/main.ccs': 'command main() { util.helper() util.MAX }',
                '/game/b/util.ccs': 'command helper() { }\ndefine MAX = 3',
            }, '/game/a/main.ccs');

            expect(diagnostics).toHaveLength(0);
        });

        it('should only resolve members declared in the named module', async () => {
            const diagnostics = await load({
                '/game/a/main.ccs': 'import "b/util.ccs"\nimport "b/other.ccs"\ncommand main() { util.elsewhere() }',
                '/game/b/util.ccs': 'command helper() { }',
                '/game/b/other.ccs': 'command elsewhere() { }',
            }, '/game/a/main.ccs');

            expect(diagnostics.map(d => d.message)).toEqual(["'util' has no member 'elsewhere'"]);
        });

        it('should report unknown modules', async () => {
            const diagnostics = await load({
                '/game/main.ccs': 'command main() { nowhere.thing() }',
            }, '/game/main.ccs');

            expect(diagnostics.map(d => d.message)).toEqual(["Unknown module 'nowhere'"]);
        });
    });

    describe('Compiler Scoping Rules', () => {
        async function bind(files: Record<string, string>, entry: string) {
            const fs = new MemoryFileSystem();
            for (const [path, content] of Object.entries(files)) {
                fs.addFile(path, content);
            }
            const program = new Program({ fileSystem: fs, rootPath: '/game', includeStdLibs: false });
            const module = await program.loadModule(entry);
            return module!.binding!.diagnostics.map(d => d.message);
        }

        it('should let a module shadow imported declarations', async () => {
            expect(await bind({
                '/game/lib/util.ccs': 'define MAX = 1\ncommand helper() { }',
                '/game/main.ccs': 'import "lib/util.ccs"\ndefine MAX = 2\ncommand helper() { MAX }',
            }, '/game/main.ccs')).toEqual([]);
        });

        it('should still report duplicates within one file', async () => {
            expect(await bind({
                '/game/main.ccs': 'define MAX = 1\ndefine MAX = 2',
            }, '/game/main.ccs')).toEqual(["Duplicate declaration of 'MAX'"]);
        });

        it('should not make imports transitive', async () => {
            expect(await bind({
                '/game/c/deep.ccs': 'command deep() { }',
                '/game/b/middle.ccs': 'import "c/deep.ccs"\ncommand middle() { deep() }',
                '/game/a/main.ccs': 'import "b/middle.ccs"\ncommand main() { middle() deep() }',
            }, '/game/a/main.ccs')).toEqual(["Undefined command 'deep'"]);
        });

        it('should allow jumping forward to a label in a block expression', async () => {
            expect(await bind({
                '/game/main.ccs': `
                    command wrap(body) "{body}"
                    command goto(target) "[0A {long target}]"
                    entry: wrap({
                        goto(done)
                        "skipped"
                    done:
                        "end"
                    })
                `,
            }, '/game/main.ccs')).toEqual([]);
        });

        it('should scope block labels to their block', async () => {
            expect(await bind({
                '/game/main.ccs': `
                    command wrap(body) "{body}"
                    command goto(target) "[0A {long target}]"
                    a: wrap({ inner: "x" })
                    b: wrap({ goto(inner) })
                `,
            }, '/game/main.ccs')).toEqual(["Undefined identifier 'inner'"]);
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
