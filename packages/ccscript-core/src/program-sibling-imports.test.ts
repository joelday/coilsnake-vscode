/**
 * Tests for implicit sibling module imports in Program
 */

import { Program } from './program';
import { MemoryFileSystem } from './fileSystem';

function createFileSystem(files: Record<string, string>): MemoryFileSystem {
    const fs = new MemoryFileSystem();
    for (const [path, content] of Object.entries(files)) {
        fs.addFile(path, content);
    }
    return fs;
}

describe('Program - Sibling Module Imports', () => {
    it('should allow files in same directory to reference each other without explicit imports', async () => {
        // Create a virtual file system with two files in the same directory
        const fs = createFileSystem({
            '/project/commands.ccs': `
                command helper() {
                    // Helper command defined in commands.ccs
                }
            `,
            '/project/main.ccs': `
                command main() {
                    helper()  // Should resolve to helper from commands.ccs
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/project',
            includeStdLibs: false,
        });

        // Load both files
        await program.loadModule('/project/commands.ccs');
        await program.loadModule('/project/main.ccs');

        // Check that main.ccs can see helper from commands.ccs
        const mainModule = program.getModule('/project/main.ccs');
        expect(mainModule).toBeDefined();

        const diagnostics = mainModule!.binding?.diagnostics || [];

        // Should have no errors - helper() should resolve
        expect(diagnostics).toHaveLength(0);
    });

    it('should import constants from sibling files', async () => {
        const fs = createFileSystem({
            '/game/constants.ccs': `
                define MAX_HP = 100
            `,
            '/game/player.ccs': `
                command init_player() {
                    ROM[0x1000] = MAX_HP  // Should resolve to constant from constants.ccs
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/game',
            includeStdLibs: false,
        });

        await program.loadModule('/game/constants.ccs');
        await program.loadModule('/game/player.ccs');

        const playerModule = program.getModule('/game/player.ccs');
        const diagnostics = playerModule!.binding?.diagnostics || [];

        expect(diagnostics).toHaveLength(0);
    });

    it('should not import from files in different directories', async () => {
        const fs = createFileSystem({
            '/project/lib/helper.ccs': `
                command lib_helper() {
                    // Helper in lib directory
                }
            `,
            '/project/src/main.ccs': `
                command main() {
                    lib_helper()  // Should NOT resolve - different directory
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/project',
            includeStdLibs: false,
        });

        await program.loadModule('/project/lib/helper.ccs');
        await program.loadModule('/project/src/main.ccs');

        const mainModule = program.getModule('/project/src/main.ccs');
        const diagnostics = mainModule!.binding?.diagnostics || [];

        // Should have an error about undefined command
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.some((d) => d.message.includes('Undefined') || d.message.includes('lib_helper')))
            .toBe(true);
    });

    it('should allow access to sibling symbols without Module prefix', async () => {
        // In CCScript, sibling files share a namespace - no qualified names needed
        const fs = createFileSystem({
            '/project/utils.ccs': `
                command helper() {
                    // Helper in same directory
                }
                
                define MAX = 100
            `,
            '/project/main.ccs': `
                command main() {
                    helper()  // Direct access, no utils.helper()
                    ROM[0] = MAX  // Direct access to constant
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/project',
            includeStdLibs: false,
        });

        await program.loadModule('/project/utils.ccs');
        await program.loadModule('/project/main.ccs');

        const mainModule = program.getModule('/project/main.ccs');
        const diagnostics = mainModule!.binding?.diagnostics || [];

        // Both helper() and MAX should resolve directly
        expect(diagnostics).toHaveLength(0);
    });

    it('should handle multiple sibling files', async () => {
        const fs = createFileSystem({
            '/game/file1.ccs': 'command cmd1() { }',
            '/game/file2.ccs': 'command cmd2() { }',
            '/game/file3.ccs': 'command cmd3() { }',
            '/game/main.ccs': `
                command main() {
                    cmd1()
                    cmd2()
                    cmd3()
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/game',
            includeStdLibs: false,
        });

        // Load all files
        await program.loadModule('/game/file1.ccs');
        await program.loadModule('/game/file2.ccs');
        await program.loadModule('/game/file3.ccs');
        await program.loadModule('/game/main.ccs');

        const mainModule = program.getModule('/game/main.ccs');
        const diagnostics = mainModule!.binding?.diagnostics || [];

        // All three commands should resolve
        expect(diagnostics).toHaveLength(0);
    });

    it('should automatically invalidate siblings when a file is reloaded', async () => {
        const fs = createFileSystem({
            '/project/utils.ccs': 'command helper() { }',
            '/project/main.ccs': `
                command main() {
                    helper()
                }
            `,
        });

        const program = new Program({
            fileSystem: fs,
            rootPath: '/project',
            includeStdLibs: false,
        });

        // Initial load
        await program.loadModule('/project/utils.ccs');
        await program.loadModule('/project/main.ccs');

        // Verify helper() resolves
        let mainModule = program.getModule('/project/main.ccs');
        let diagnostics = mainModule!.binding?.diagnostics || [];
        expect(diagnostics).toHaveLength(0);

        // Update utils.ccs to add a new command
        fs.addFile('/project/utils.ccs', `
            command helper() { }
            command new_helper() { }
        `);

        // Update main.ccs to use the new command
        fs.addFile('/project/main.ccs', `
            command main() {
                helper()
                new_helper()  // Should resolve after reload
            }
        `);

        // Reload utils.ccs - should auto-invalidate main.ccs
        await program.reloadModule('/project/utils.ccs');

        // Reload main.ccs to pick up the new file content
        await program.reloadModule('/project/main.ccs');

        // Verify both commands now resolve
        mainModule = program.getModule('/project/main.ccs');
        diagnostics = mainModule!.binding?.diagnostics || [];
        expect(diagnostics).toHaveLength(0);
    });

    it('should drop declarations removed from a reloaded sibling', async () => {
        const fs = createFileSystem({
            '/project/utils.ccs': 'command helper() { }',
            '/project/main.ccs': 'command main() { helper() }',
        });

        const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
        await program.loadModule('/project/utils.ccs');
        await program.loadModule('/project/main.ccs');

        // Reload several times, as the LSP does on every edit
        await program.reloadModule('/project/utils.ccs');
        await program.reloadModule('/project/utils.ccs');
        expect(program.getModule('/project/main.ccs')!.group!.modules).toHaveLength(2);

        fs.addFile('/project/utils.ccs', 'command other() { }');
        await program.reloadModule('/project/utils.ccs');

        const diagnostics = program.getModule('/project/main.ccs')!.binding?.diagnostics || [];
        expect(diagnostics.some(d => d.message.includes('helper'))).toBe(true);
    });

    it('should rebind importers in other directories against the reloaded module', async () => {
        const fs = createFileSystem({
            '/project/lib/utils.ccs': 'command helper() { }',
            '/project/src/main.ccs': `
                import "lib/utils.ccs"
                command main() { renamed() }
            `,
        });

        const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
        await program.loadModule('/project/src/main.ccs');
        expect(program.getModule('/project/src/main.ccs')!.binding!.diagnostics.length).toBeGreaterThan(0);

        fs.addFile('/project/lib/utils.ccs', 'command renamed() { }');
        await program.reloadModule('/project/lib/utils.ccs');

        const main = program.getModule('/project/src/main.ccs')!;
        expect(main.dependencies[0]).toBe(program.getModule('/project/lib/utils.ccs'));
        expect(main.binding!.diagnostics).toHaveLength(0);
    });

    it('should not accumulate import diagnostics across reloads', async () => {
        const fs = createFileSystem({
            '/project/main.ccs': 'import missing',
        });

        const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
        await program.loadModule('/project/main.ccs');
        await program.reloadModule('/project/main.ccs');
        await program.reloadModule('/project/main.ccs');
        expect(program.getDiagnostics()).toHaveLength(1);

        fs.addFile('/project/main.ccs', 'define x = 1');
        await program.reloadModule('/project/main.ccs');
        expect(program.getDiagnostics()).toHaveLength(0);
    });

    it('should record which file each referenced symbol was declared in', async () => {
        const fs = createFileSystem({
            '/project/utils.ccs': 'command helper() { }',
            '/project/main.ccs': 'define LOCAL = 1\ncommand main() { helper() LOCAL }',
        });

        const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
        const main = await program.loadModule('/project/main.ccs');

        const referenced = [...main!.binding!.references.values()];
        expect(referenced.find(s => s.name === 'helper')!.modulePath).toBe('/project/utils.ccs');
        expect(referenced.find(s => s.name === 'LOCAL')!.modulePath).toBe('/project/main.ccs');

        // Position lookups in main.ccs must not return utils.ccs symbols at the same offset
        const helper = referenced.find(s => s.name === 'helper')!;
        expect(main!.binding!.symbols.getSymbolAt(helper.position, '/project/main.ccs')?.name).not.toBe('helper');
    });

    describe('sibling discovery', () => {
        it('should resolve symbols from siblings that were never loaded explicitly', async () => {
            const fs = createFileSystem({
                '/project/helpers.ccs': 'command helper() { }\ndefine MAX = 10',
                '/project/main.ccs': 'command main() { helper() MAX }',
                '/other/unrelated.ccs': 'command unrelated() { }',
            });

            const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
            const main = await program.loadModule('/project/main.ccs');

            expect(main!.binding!.diagnostics).toHaveLength(0);
            expect(program.getModule('/project/helpers.ccs')).toBeDefined();
            expect(program.getModule('/other/unrelated.ccs')).toBeUndefined();
        });

        it('should not flag a sibling importing the opened file as circular', async () => {
            const fs = createFileSystem({
                '/project/main.ccs': 'command main() { }',
                '/project/other.ccs': 'import main\ncommand other() { main() }',
            });

            const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
            await program.loadModule('/project/main.ccs');

            expect(program.getDiagnostics()).toHaveLength(0);
            expect(program.getModule('/project/other.ccs')!.binding!.diagnostics).toHaveLength(0);
        });

        it('should bind siblings that import each other', async () => {
            const fs = createFileSystem({
                '/project/a.ccs': 'command a() { b() }',
                '/project/b.ccs': 'import a\ncommand b() { a() }',
                '/project/c.ccs': 'import b\ncommand c() { a() b() }',
            });

            const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
            await program.loadModule('/project/a.ccs');

            for (const name of ['a', 'b', 'c']) {
                const module = program.getModule(`/project/${name}.ccs`)!;
                expect(module.binding).toBeDefined();
                expect(module.binding!.diagnostics).toHaveLength(0);
            }
        });

        it('should load std lib directory siblings without waiting on themselves', async () => {
            const fs = createFileSystem({
                '/lib/std.ccs': 'command std_cmd() { }',
                '/lib/stdarg.ccs': 'command stdarg_cmd() { }',
                '/lib/extra.ccs': 'command extra() { std_cmd() }',
                '/project/main.ccs': 'command main() { std_cmd() stdarg_cmd() }',
            });

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: true,
                stdLibPaths: { std: '/lib/std.ccs', stdarg: '/lib/stdarg.ccs' },
            });
            const main = await program.loadModule('/project/main.ccs');

            expect(main!.binding!.diagnostics).toHaveLength(0);
            expect(program.getModule('/lib/extra.ccs')!.binding!.diagnostics).toHaveLength(0);
            expect(program.getDiagnostics()).toHaveLength(0);
        });

        it('should not discover siblings when disabled', async () => {
            const fs = createFileSystem({
                '/project/helpers.ccs': 'command helper() { }',
                '/project/main.ccs': 'command main() { helper() }',
            });

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
                loadSiblings: false,
            });
            await program.loadModule('/project/main.ccs');

            expect(program.getModule('/project/helpers.ccs')).toBeUndefined();
            const siblings = await program.loadSiblingFiles('/project/main.ccs');
            expect(siblings.map(m => m.name)).toEqual(['helpers']);
            expect(program.getModule('/project/main.ccs')!.binding!.diagnostics).toHaveLength(0);
        });
    });
});
