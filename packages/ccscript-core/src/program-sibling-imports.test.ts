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

        const diagnostics = mainModule!.tree.getSemanticDiagnostics();

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
        const diagnostics = playerModule!.tree.getSemanticDiagnostics();

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
        const diagnostics = mainModule!.tree.getSemanticDiagnostics();

        // Should have an error about undefined command
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.some(d => d.message.includes('Undefined') || d.message.includes('lib_helper')))
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
        const diagnostics = mainModule!.tree.getSemanticDiagnostics();

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
        const diagnostics = mainModule!.tree.getSemanticDiagnostics();

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
        let diagnostics = mainModule!.tree.getSemanticDiagnostics();
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
        diagnostics = mainModule!.tree.getSemanticDiagnostics();
        expect(diagnostics).toHaveLength(0);
    });
});
