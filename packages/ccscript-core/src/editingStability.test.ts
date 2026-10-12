/**
 * Editing stability: random edits (as while typing) must never make parsing or binding throw,
 * and the tree must always cover the source exactly, with every token at its source position.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SyntaxTree } from './syntaxTree';
import { Program } from './program';
import { MemoryFileSystem } from './fileSystem';

const fixturesDir = path.join(__dirname, 'test', 'fixtures');
const fixtures = fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.ccs'))
    .map(f => ({ name: f, source: fs.readFileSync(path.join(fixturesDir, f), 'utf-8') }));

// Fragments that tend to break parsers mid-edit
const fragments = [
    '"', '{', '}', '(', ')', '[', ']', ',', ':', '.', '=', '/*', '*/', '//', '\n', '\r\n', '\t', ' ',
    'command ', 'define ', 'if ', 'else ', 'menu ', 'import ', 'ROM[', 'ROMTBL[', 'flag ', 'byte ',
    'insertbin ', '"{', '{x', 'a.b', '0x', '0xZZ', '12', 'foo(', 'label:', '"[1A 0C]"', '\\',
];

function createRandom(seed: number): () => number {
    // mulberry32
    return () => {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mutate(source: string, random: () => number): string {
    const at = Math.floor(random() * (source.length + 1));
    const choice = random();
    if (choice < 0.4) {
        const length = Math.floor(random() * 12);
        return source.slice(0, at) + source.slice(at + length);
    }
    if (choice < 0.9) {
        return source.slice(0, at) + fragments[Math.floor(random() * fragments.length)] + source.slice(at);
    }
    // Paste a slice of the file somewhere else
    const from = Math.floor(random() * source.length);
    return source.slice(0, at) + source.slice(from, from + 40) + source.slice(at);
}

function checkTree(source: string): void {
    const tree = SyntaxTree.parse(source);
    expect(tree.getRoot().fullWidth).toBe(source.length);
    for (const token of tree.getTokens()) {
        if (source.substr(token.span.start, token.text.length) !== token.text) {
            throw new Error(`Token ${JSON.stringify(token.text)} misplaced at ${token.span.start} in:\n${source}`);
        }
    }
    for (const diagnostic of tree.getDiagnostics()) {
        expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.span.start + diagnostic.span.length).toBeLessThanOrEqual(source.length);
    }
}

describe('Editing stability', () => {
    it.each(fixtures.map(f => [f.name, f.source]))('should parse random edits of %s', (_name, original) => {
        const random = createRandom(original.length);
        let source = original;
        for (let i = 0; i < 150; i++) {
            source = mutate(source, random);
            checkTree(source);
            if (i % 30 === 29) {
                source = original;
            }
        }
    });

    it('should parse every prefix of a file (typing it out)', () => {
        const source = fixtures.find(f => f.name.startsWith('12-'))!.source;
        for (let end = 0; end <= source.length; end++) {
            checkTree(source.slice(0, end));
        }
    });

    it('should load and rebind random edits through a Program', async () => {
        const random = createRandom(1234);
        const memoryFs = new MemoryFileSystem();
        memoryFs.addFile('/project/lib.ccs', 'command helper(a, b) { }\ndefine MAX = 3');
        for (const fixture of fixtures) {
            memoryFs.addFile(`/project/${fixture.name}`, fixture.source);
        }

        const program = new Program({ fileSystem: memoryFs, rootPath: '/project', includeStdLibs: false });
        for (const fixture of fixtures) {
            let source = `import lib\n${fixture.source}`;
            const filePath = `/project/${fixture.name}`;
            for (let i = 0; i < 25; i++) {
                source = mutate(source, random);
                memoryFs.addFile(filePath, source);
                const module = await program.reloadModule(filePath);
                expect(module!.tree.source).toBe(source);
                for (const diagnostic of module!.binding!.diagnostics) {
                    expect(diagnostic.position + diagnostic.length).toBeLessThanOrEqual(source.length);
                }
            }
        }
    });
});
