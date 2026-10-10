/**
 * Tests for how files see each other, matching the CCScript compiler used by CoilSnake
 * (ccscript_legacy): files in the same directory don't share names; unqualified names need
 * an import, while `module.member` works for any loaded module.
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

function createProgram(fs: MemoryFileSystem, rootPath = '/project'): Program {
    return new Program({ fileSystem: fs, rootPath, includeStdLibs: false });
}

function messages(program: Program, path: string): string[] {
    return (program.getModule(path)!.binding?.diagnostics || []).map(d => d.message);
}

describe('Program - Module Visibility', () => {
    it('should not resolve unqualified names from same-directory files without an import', async () => {
        const fs = createFileSystem({
            '/project/commands.ccs': 'command helper() { }\ndefine MAX = 1',
            '/project/main.ccs': 'command main() { helper() MAX }',
        });

        const program = createProgram(fs);
        await program.loadModule('/project/main.ccs');

        expect(messages(program, '/project/main.ccs')).toEqual([
            "Undefined command 'helper'",
            "Undefined identifier 'MAX'",
        ]);
    });

    it('should resolve commands and constants from an imported same-directory file', async () => {
        const fs = createFileSystem({
            '/game/constants.ccs': 'define MAX_HP = 100\ncommand heal() { }',
            '/game/player.ccs': `
                import constants
                command init_player() {
                    ROM[0x1000] = MAX_HP
                    heal()
                }
            `,
        });

        const program = createProgram(fs, '/game');
        await program.loadModule('/game/player.ccs');

        expect(messages(program, '/game/player.ccs')).toEqual([]);
    });

    it('should resolve qualified references to same-directory files without an import', async () => {
        const fs = createFileSystem({
            '/project/utils.ccs': 'command helper() { }\ndefine MAX = 100',
            '/project/main.ccs': 'command main() { utils.helper() ROM[0] = utils.MAX }',
        });

        const program = createProgram(fs);
        await program.loadModule('/project/main.ccs');

        expect(messages(program, '/project/main.ccs')).toEqual([]);
    });

    it('should resolve imports from other directories', async () => {
        const fs = createFileSystem({
            '/project/lib/helper.ccs': 'command lib_helper() { }',
            '/project/src/main.ccs': 'import "../lib/helper.ccs"\ncommand main() { lib_helper() }',
            '/project/src/other.ccs': 'command other() { lib_helper() }',
        });

        const program = createProgram(fs);
        await program.loadModule('/project/src/main.ccs');

        expect(messages(program, '/project/src/main.ccs')).toEqual([]);
        expect(messages(program, '/project/src/other.ccs')).toEqual(["Undefined command 'lib_helper'"]);
    });

    describe('reloading', () => {
        it('should rebind importers when an imported file changes', async () => {
            const fs = createFileSystem({
                '/project/utils.ccs': 'command helper() { }',
                '/project/main.ccs': 'import utils\ncommand main() { helper() new_helper() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');
            expect(messages(program, '/project/main.ccs')).toEqual(["Undefined command 'new_helper'"]);

            fs.addFile('/project/utils.ccs', 'command helper() { }\ncommand new_helper() { }');
            await program.reloadModule('/project/utils.ccs');

            expect(messages(program, '/project/main.ccs')).toEqual([]);
        });

        it('should drop declarations removed from a reloaded import', async () => {
            const fs = createFileSystem({
                '/project/utils.ccs': 'command helper() { }',
                '/project/main.ccs': 'import utils\ncommand main() { helper() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');

            // Reload several times, as the LSP does on every edit
            await program.reloadModule('/project/utils.ccs');
            await program.reloadModule('/project/utils.ccs');
            expect(program.getAllModules()).toHaveLength(2);

            fs.addFile('/project/utils.ccs', 'command other() { }');
            await program.reloadModule('/project/utils.ccs');

            expect(messages(program, '/project/main.ccs')).toEqual(["Undefined command 'helper'"]);
        });

        it('should rebind qualified references when the referenced file changes', async () => {
            const fs = createFileSystem({
                '/project/utils.ccs': 'command helper() { }',
                '/project/main.ccs': 'command main() { utils.renamed() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');
            expect(messages(program, '/project/main.ccs')).toEqual(["'utils' has no member 'renamed'"]);

            fs.addFile('/project/utils.ccs', 'command renamed() { }');
            await program.reloadModule('/project/utils.ccs');

            expect(messages(program, '/project/main.ccs')).toEqual([]);
        });

        it('should point importers at the reloaded module', async () => {
            const fs = createFileSystem({
                '/project/lib/utils.ccs': 'command helper() { }',
                '/project/src/main.ccs': 'import "lib/utils.ccs"\ncommand main() { helper() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/src/main.ccs');
            await program.reloadModule('/project/lib/utils.ccs');

            const main = program.getModule('/project/src/main.ccs')!;
            expect(main.dependencies[0]).toBe(program.getModule('/project/lib/utils.ccs'));
        });

        it('should not accumulate import diagnostics across reloads', async () => {
            const fs = createFileSystem({
                '/project/main.ccs': 'import missing',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');
            await program.reloadModule('/project/main.ccs');
            await program.reloadModule('/project/main.ccs');
            expect(program.getDiagnostics()).toHaveLength(1);

            fs.addFile('/project/main.ccs', 'define x = 1');
            await program.reloadModule('/project/main.ccs');
            expect(program.getDiagnostics()).toHaveLength(0);
        });
    });

    it('should record which file each referenced symbol was declared in', async () => {
        const fs = createFileSystem({
            '/project/utils.ccs': 'command helper() { }',
            '/project/main.ccs': 'import utils\ndefine LOCAL = 1\ncommand main() { helper() LOCAL }',
        });

        const program = createProgram(fs);
        const main = await program.loadModule('/project/main.ccs');

        const referenced = [...main!.binding!.references.values()];
        expect(referenced.find(s => s.name === 'helper')!.modulePath).toBe('/project/utils.ccs');
        expect(referenced.find(s => s.name === 'LOCAL')!.modulePath).toBe('/project/main.ccs');

        // Position lookups in main.ccs must not return utils.ccs symbols at the same offset
        const helper = referenced.find(s => s.name === 'helper')!;
        expect(main!.binding!.symbols.getSymbolAt(helper.position, '/project/main.ccs')?.name).not.toBe('helper');
    });

    describe('sibling discovery', () => {
        it('should load same-directory files so qualified references to them resolve', async () => {
            const fs = createFileSystem({
                '/project/helpers.ccs': 'command helper() { }',
                '/project/main.ccs': 'command main() { helpers.helper() }',
                '/other/unrelated.ccs': 'command unrelated() { }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');

            expect(messages(program, '/project/main.ccs')).toEqual([]);
            expect(program.getModule('/project/helpers.ccs')!.binding).toBeDefined();
            expect(program.getModule('/other/unrelated.ccs')).toBeUndefined();
        });

        it('should not flag a sibling importing the opened file as circular', async () => {
            const fs = createFileSystem({
                '/project/main.ccs': 'command main() { }',
                '/project/other.ccs': 'import main\ncommand other() { main() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/main.ccs');

            expect(program.getDiagnostics()).toHaveLength(0);
            expect(messages(program, '/project/other.ccs')).toEqual([]);
        });

        it('should bind siblings that import each other', async () => {
            const fs = createFileSystem({
                '/project/a.ccs': 'import b\ncommand a() { b() }',
                '/project/b.ccs': 'import a\ncommand b() { a() }',
                '/project/c.ccs': 'import a\nimport b\ncommand c() { a() b() }',
            });

            const program = createProgram(fs);
            await program.loadModule('/project/a.ccs');

            for (const name of ['a', 'b', 'c']) {
                expect(messages(program, `/project/${name}.ccs`)).toEqual([]);
            }
        });

        it('should implicitly import std libs into every module, including std lib siblings', async () => {
            const fs = createFileSystem({
                '/lib/std.ccs': 'command std_cmd() { stdarg_cmd() }',
                '/lib/stdarg.ccs': 'command stdarg_cmd() { std_cmd() }',
                '/lib/extra.ccs': 'command extra() { std_cmd() }',
                '/project/main.ccs': 'command main() { std_cmd() stdarg_cmd() }',
            });

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: true,
                stdLibPaths: { std: '/lib/std.ccs', stdarg: '/lib/stdarg.ccs' },
            });
            await program.loadModule('/project/main.ccs');

            for (const path of ['/project/main.ccs', '/lib/std.ccs', '/lib/stdarg.ccs', '/lib/extra.ccs']) {
                expect(messages(program, path)).toEqual([]);
            }
            expect(program.getDiagnostics()).toHaveLength(0);
        });

        it('should not discover siblings when disabled', async () => {
            const fs = createFileSystem({
                '/project/helpers.ccs': 'command helper() { }',
                '/project/main.ccs': 'command main() { helpers.helper() }',
            });

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
                loadSiblings: false,
            });
            await program.loadModule('/project/main.ccs');

            expect(program.getModule('/project/helpers.ccs')).toBeUndefined();
            expect(messages(program, '/project/main.ccs')).toEqual(["Unknown module 'helpers'"]);

            const siblings = await program.loadSiblingFiles('/project/main.ccs');
            expect(siblings.map(m => m.name)).toEqual(['helpers']);
            expect(messages(program, '/project/main.ccs')).toEqual([]);
        });
    });
});
