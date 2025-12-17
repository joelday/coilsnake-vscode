/**
 * Tests for Program (multi-file compilation)
 */

import { Program } from './program';
import { MemoryFileSystem } from './fileSystem';

describe('Program', () => {
    let fs: MemoryFileSystem;

    beforeEach(() => {
        fs = new MemoryFileSystem();
    });

    describe('Single module loading', () => {
        it('should load a simple module', async () => {
            fs.addFile('/project/main.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module).toBeDefined();
            expect(module!.name).toBe('main');
            expect(module!.filePath).toBe('/project/main.ccs');
            expect(module!.imports).toHaveLength(0);
            expect(module!.dependencies).toHaveLength(0);
        });

        it('should extract module name from path', async () => {
            fs.addFile('/lib/mymodule.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/lib/mymodule.ccs');
            expect(module!.name).toBe('mymodule');
        });

        it('should return null for non-existent file', async () => {
            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/missing.ccs');
            expect(module).toBeNull();
            expect(program.getDiagnostics()).toHaveLength(1);
            expect(program.getDiagnostics()[0].message).toContain('not found');
        });

        it('should cache loaded modules', async () => {
            fs.addFile('/project/main.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module1 = await program.loadModule('/project/main.ccs');
            const module2 = await program.loadModule('/project/main.ccs');

            expect(module1).toBe(module2);
        });
    });

    describe('Import extraction', () => {
        it('should extract import with identifier', async () => {
            fs.addFile('/project/main.ccs', 'import mylib');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.imports).toEqual(['mylib.ccs']);
        });

        it('should extract import with string literal', async () => {
            fs.addFile('/project/main.ccs', 'import "path/to/file.ccs"');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.imports).toEqual(['path/to/file.ccs']);
        });

        it('should extract multiple imports', async () => {
            fs.addFile('/project/main.ccs', `
                import lib1
                import "lib2.ccs"
                import lib3
            `);

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.imports).toEqual(['lib1.ccs', 'lib2.ccs', 'lib3.ccs']);
        });
    });

    describe('Import resolution', () => {
        it('should resolve import from same directory', async () => {
            fs.addFile('/project/main.ccs', 'import helper');
            fs.addFile('/project/helper.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.dependencies).toHaveLength(1);
            expect(module!.dependencies[0].name).toBe('helper');
        });

        it('should resolve import from project root', async () => {
            fs.addFile('/project/subdir/main.ccs', 'import helper');
            fs.addFile('/project/helper.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/subdir/main.ccs');
            expect(module!.dependencies).toHaveLength(1);
            expect(module!.dependencies[0].name).toBe('helper');
        });

        it('should resolve import from lib directory', async () => {
            fs.addFile('/project/main.ccs', 'import mylib');
            fs.addFile('/libs/mylib.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                libPaths: ['/libs'],
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.dependencies).toHaveLength(1);
            expect(module!.dependencies[0].name).toBe('mylib');
        });

        it('should prioritize same directory over project root', async () => {
            fs.addFile('/project/subdir/main.ccs', 'import helper');
            fs.addFile('/project/subdir/helper.ccs', 'define x = 1');
            fs.addFile('/project/helper.ccs', 'define y = 2');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/subdir/main.ccs');
            expect(module!.dependencies).toHaveLength(1);
            expect(module!.dependencies[0].filePath).toBe('/project/subdir/helper.ccs');
        });

        it('should report error for unresolved import', async () => {
            fs.addFile('/project/main.ccs', 'import missing');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.dependencies).toHaveLength(0);
            expect(program.getDiagnostics()).toHaveLength(1);
            expect(program.getDiagnostics()[0].message).toContain('Cannot resolve import');
        });
    });

    describe('Recursive import loading', () => {
        it('should load transitive dependencies', async () => {
            fs.addFile('/project/main.ccs', 'import lib1');
            fs.addFile('/project/lib1.ccs', 'import lib2');
            fs.addFile('/project/lib2.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const _module = await program.loadModule('/project/main.ccs');
            expect(program.getAllModules()).toHaveLength(3);

            const lib1 = program.getModuleByName('lib1');
            expect(lib1).toBeDefined();
            expect(lib1!.dependencies).toHaveLength(1);
            expect(lib1!.dependencies[0].name).toBe('lib2');
        });

        it('should handle diamond dependencies', async () => {
            fs.addFile('/project/main.ccs', 'import lib1\nimport lib2');
            fs.addFile('/project/lib1.ccs', 'import common');
            fs.addFile('/project/lib2.ccs', 'import common');
            fs.addFile('/project/common.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const _module2 = await program.loadModule('/project/main.ccs');
            expect(program.getAllModules()).toHaveLength(4);

            // common should only be loaded once
            const commonModules = program.getAllModules().filter(m => m.name === 'common');
            expect(commonModules).toHaveLength(1);
        });
    });

    describe('Circular import detection', () => {
        it('should detect direct circular import', async () => {
            fs.addFile('/project/a.ccs', 'import b');
            fs.addFile('/project/b.ccs', 'import a');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/a.ccs');
            const diagnostics = program.getDiagnostics();
            const circularErrors = diagnostics.filter(d => d.message.includes('Circular'));
            expect(circularErrors.length).toBeGreaterThan(0);
        });

        it('should detect indirect circular import', async () => {
            fs.addFile('/project/a.ccs', 'import b');
            fs.addFile('/project/b.ccs', 'import c');
            fs.addFile('/project/c.ccs', 'import a');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/a.ccs');
            const diagnostics = program.getDiagnostics();
            const circularErrors = diagnostics.filter(d => d.message.includes('Circular'));
            expect(circularErrors.length).toBeGreaterThan(0);
        });
    });

    describe('Standard library inclusion', () => {
        it('should auto-include std libs when enabled', async () => {
            fs.addFile('/project/main.ccs', 'define x = 1');
            fs.addFile('/libs/std.ccs', '');
            fs.addFile('/libs/stdarg.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                libPaths: ['/libs'],
                includeStdLibs: true,
                stdLibPaths: {
                    std: '/libs/std.ccs',
                    stdarg: '/libs/stdarg.ccs',
                },
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.dependencies.length).toBeGreaterThanOrEqual(2);

            const hasStd = module!.dependencies.some(d => d.name === 'std');
            const hasStdarg = module!.dependencies.some(d => d.name === 'stdarg');
            expect(hasStd).toBe(true);
            expect(hasStdarg).toBe(true);
        });

        it('should not include std libs when disabled', async () => {
            fs.addFile('/project/main.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const module = await program.loadModule('/project/main.ccs');
            expect(module!.dependencies).toHaveLength(0);
        });
    });

    describe('Dependency ordering', () => {
        it('should return modules in dependency order', async () => {
            fs.addFile('/project/main.ccs', 'import lib1\nimport lib2');
            fs.addFile('/project/lib1.ccs', 'import lib2');
            fs.addFile('/project/lib2.ccs', 'define x = 1');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/main.ccs');
            const ordered = program.getModulesInDependencyOrder();

            // lib2 should come before lib1, which should come before main
            const lib2Idx = ordered.findIndex(m => m.name === 'lib2');
            const lib1Idx = ordered.findIndex(m => m.name === 'lib1');
            const mainIdx = ordered.findIndex(m => m.name === 'main');

            expect(lib2Idx).toBeLessThan(lib1Idx);
            expect(lib1Idx).toBeLessThan(mainIdx);
        });
    });

    describe('Module queries', () => {
        it('should get module by path', async () => {
            fs.addFile('/project/main.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/main.ccs');
            const module = program.getModule('/project/main.ccs');
            expect(module).toBeDefined();
            expect(module!.name).toBe('main');
        });

        it('should get module by name', async () => {
            fs.addFile('/project/main.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/main.ccs');
            const module = program.getModuleByName('main');
            expect(module).toBeDefined();
            expect(module!.filePath).toBe('/project/main.ccs');
        });

        it('should get all modules', async () => {
            fs.addFile('/project/main.ccs', 'import lib');
            fs.addFile('/project/lib.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/main.ccs');
            const modules = program.getAllModules();
            expect(modules).toHaveLength(2);
        });
    });

    describe('Module name collisions', () => {
        it('should detect module name collision', async () => {
            fs.addFile('/project/lib.ccs', '');
            fs.addFile('/other/lib.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            await program.loadModule('/project/lib.ccs');
            const module2 = await program.loadModule('/other/lib.ccs');

            expect(module2).toBeNull();
            const diagnostics = program.getDiagnostics();
            const collisionError = diagnostics.find(d => d.message.includes('collision'));
            expect(collisionError).toBeDefined();
        });
    });

    describe('loadModules batch loading', () => {
        it('should load multiple modules at once', async () => {
            fs.addFile('/project/file1.ccs', '');
            fs.addFile('/project/file2.ccs', '');
            fs.addFile('/project/file3.ccs', '');

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const modules = await program.loadModules([
                '/project/file1.ccs',
                '/project/file2.ccs',
                '/project/file3.ccs',
            ]);

            expect(modules).toHaveLength(3);
            expect(program.getAllModules()).toHaveLength(3);
        });

        it('should skip failed modules in batch load', async () => {
            fs.addFile('/project/file1.ccs', '');
            fs.addFile('/project/file3.ccs', '');
            // file2.ccs doesn't exist

            const program = new Program({
                fileSystem: fs,
                rootPath: '/project',
                includeStdLibs: false,
            });

            const modules = await program.loadModules([
                '/project/file1.ccs',
                '/project/file2.ccs', // missing
                '/project/file3.ccs',
            ]);

            expect(modules).toHaveLength(2);
            expect(program.getDiagnostics()).toHaveLength(1);
        });
    });
});
