/**
 * Tests for which declarations a build evaluates. Like the CCScript compiler, which only
 * evaluates a command body or constant value when the code it compiles reaches it, unresolved
 * names in unreached declarations are warnings, and errors once they're reached.
 */

import { Program } from './program';
import { MemoryFileSystem } from './fileSystem';

async function load(files: Record<string, string>, path = '/project/main.ccs') {
    const fs = new MemoryFileSystem();
    for (const [filePath, content] of Object.entries(files)) {
        fs.addFile(filePath, content);
    }
    const program = new Program({ fileSystem: fs, rootPath: '/project', includeStdLibs: false });
    await program.loadModule(path);
    return { fs, program };
}

function diagnostics(program: Program, path = '/project/main.ccs'): string[] {
    return program.getSemanticDiagnostics(program.getModule(path)!).map(d => `${d.severity}: ${d.message}`);
}

describe('Program - Evaluated declarations', () => {
    it('warns about unresolved names in a command nothing uses', async () => {
        const { program } = await load({ '/project/main.ccs': 'command unused() { nope missing() }' });
        expect(diagnostics(program)).toEqual([
            "warning: Undefined identifier 'nope' (an error once command 'unused' is used)",
            "warning: Undefined command 'missing' (an error once command 'unused' is used)",
        ]);
    });

    it('reports unresolved names in a command top-level code uses as errors', async () => {
        const { program } = await load({ '/project/main.ccs': 'command used { nope }\nused' });
        expect(diagnostics(program)).toEqual(["error: Undefined identifier 'nope'"]);
    });

    it('reports unresolved names in top-level code as errors', async () => {
        const { program } = await load({ '/project/main.ccs': 'nope\n"text {missing(1)}"' });
        expect(diagnostics(program)).toEqual([
            "error: Undefined identifier 'nope'",
            "error: Undefined command 'missing'",
        ]);
    });

    it('follows uses through other commands and constants', async () => {
        const { program } = await load({
            '/project/main.ccs': [
                'command inner { nope }',
                'define VIA = inner',
                'command outer { VIA }',
                'command cold_inner { nope }',
                'command cold_outer { cold_inner }',
                '"{outer}"',
            ].join('\n'),
        });
        expect(diagnostics(program)).toEqual([
            "error: Undefined identifier 'nope'",
            "warning: Undefined identifier 'nope' (an error once command 'cold_inner' is used)",
        ]);
    });

    it('treats constant values like command bodies', async () => {
        const { program } = await load({ '/project/main.ccs': 'define COLD = nope\ndefine HOT = nope\nHOT' });
        expect(diagnostics(program)).toEqual([
            "warning: Undefined identifier 'nope' (an error once constant 'COLD' is used)",
            "error: Undefined identifier 'nope'",
        ]);
    });

    it('treats nested declarations as part of the top-level command', async () => {
        const { program } = await load({ '/project/main.ccs': 'command outer { define INNER = nope }' });
        expect(diagnostics(program)).toEqual([
            "warning: Undefined identifier 'nope' (an error once command 'outer' is used)",
        ]);
    });

    it('counts uses from other modules, imported or qualified', async () => {
        const { program } = await load({
            '/project/lib.ccs': 'command by_import { nope }\ncommand by_name { nope }\ncommand unused { nope }',
            '/project/main.ccs': 'import lib\nby_import\nlib.by_name',
        });
        expect(diagnostics(program, '/project/lib.ccs')).toEqual([
            "error: Undefined identifier 'nope'",
            "error: Undefined identifier 'nope'",
            "warning: Undefined identifier 'nope' (an error once command 'unused' is used)",
        ]);
    });

    it('updates when the code using a command changes', async () => {
        const { fs, program } = await load({
            '/project/lib.ccs': 'command helper { nope }',
            '/project/main.ccs': 'import lib\nhelper',
        });
        expect(diagnostics(program, '/project/lib.ccs')).toEqual(["error: Undefined identifier 'nope'"]);

        fs.addFile('/project/main.ccs', 'import lib');
        await program.reloadModule('/project/main.ccs');
        expect(diagnostics(program, '/project/lib.ccs')).toEqual([
            "warning: Undefined identifier 'nope' (an error once command 'helper' is used)",
        ]);

        fs.addFile('/project/main.ccs', 'import lib\nhelper');
        await program.reloadModule('/project/main.ccs');
        expect(diagnostics(program, '/project/lib.ccs')).toEqual(["error: Undefined identifier 'nope'"]);

        await program.removeModule('/project/main.ccs');
        expect(diagnostics(program, '/project/lib.ccs')).toEqual([
            "warning: Undefined identifier 'nope' (an error once command 'helper' is used)",
        ]);
    });

    it('keeps other problems in unused commands as errors', async () => {
        const { program } = await load({ '/project/main.ccs': 'command takes(a) { }\ncommand unused { takes() }' });
        expect(diagnostics(program)).toEqual([
            "error: Too few arguments to command 'takes': expected 1, got 0",
        ]);
    });
});
