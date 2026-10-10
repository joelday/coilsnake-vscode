/**
 * Editing stability: requests and diagnostics stay consistent with the document while it changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    Diagnostic,
    FileChangeType,
    Hover,
    Position,
    Range,
} from 'vscode-languageserver-protocol';
import { TestClient, messageText, positionOf } from './testClient';

let client: TestClient;
afterEach(() => client?.dispose());

const messages = (diagnostics: Diagnostic[]) => diagnostics.map(messageText);

describe('Editing', () => {
    it('answers requests against the latest edit, without waiting for diagnostics', async () => {
        client = await TestClient.start({ files: { '/project/main.ccs': 'define A = 1' } });
        await client.open('/project/main.ccs');

        // Rename the constant and immediately hover the new name
        await client.change('/project/main.ccs', '// The answer\ndefine ANSWER = 42');
        const hover = await client.request<Hover>('textDocument/hover', '/project/main.ccs',
            positionOf(client.text('/project/main.ccs'), 'ANSWER'));
        expect(JSON.stringify(hover.contents)).toContain('define ANSWER = 42');
    });

    it('publishes diagnostics for the final version after rapid edits', async () => {
        client = await TestClient.start({ files: { '/project/main.ccs': '' } });
        await client.open('/project/main.ccs');

        const final = 'command main() { next }';
        for (let i = 1; i <= final.length; i++) {
            void client.change('/project/main.ccs', final.slice(0, i));
        }
        await client.change('/project/main.ccs', final);

        expect(await client.waitForDiagnostics('/project/main.ccs')).toEqual([]);
    });

    it('applies incremental edits', async () => {
        client = await TestClient.start({ files: { '/project/main.ccs': 'command main() {\n    nxt\n}' } });
        await client.open('/project/main.ccs');
        expect(messages(await client.waitForDiagnostics('/project/main.ccs'))).toEqual(["Undefined identifier 'nxt'"]);

        await client.edit('/project/main.ccs', Range.create(1, 5, 1, 5), 'e');
        expect(await client.waitForDiagnostics('/project/main.ccs')).toEqual([]);
    });

    it('updates open dependents when an imported file changes', async () => {
        client = await TestClient.start({
            files: {
                '/project/lib.ccs': 'command helper() { }',
                '/project/main.ccs': 'import lib\ncommand main() { helper() }',
            },
        });
        await client.open('/project/main.ccs');
        await client.open('/project/lib.ccs');
        expect(await client.waitForDiagnostics('/project/main.ccs')).toEqual([]);

        await client.change('/project/lib.ccs', 'command renamed() { }');
        expect(messages(await client.waitForDiagnostics('/project/main.ccs', d => d.length > 0)))
            .toEqual(["Undefined command 'helper'"]);
    });

    it('reverts to the file on disk when a document is closed without saving', async () => {
        client = await TestClient.start({
            files: {
                '/project/lib.ccs': 'command helper() { }',
                '/project/main.ccs': 'import lib\ncommand main() { helper() }',
            },
        });
        await client.open('/project/main.ccs');
        await client.open('/project/lib.ccs');
        await client.change('/project/lib.ccs', 'command unsaved() { }');
        await client.waitForDiagnostics('/project/main.ccs', d => d.length > 0);

        await client.close('/project/lib.ccs');
        expect(await client.waitForDiagnostics('/project/main.ccs', d => d.length === 0)).toEqual([]);
    });

    it('picks up deleted and created files', async () => {
        client = await TestClient.start({
            files: {
                '/project/lib.ccs': 'command helper() { }',
                '/project/main.ccs': 'import lib\ncommand main() { helper() }',
            },
        });
        await client.open('/project/main.ccs');
        await client.waitForDiagnostics('/project/main.ccs');

        client.fs.removeFile('/project/lib.ccs');
        await client.fileChanged('/project/lib.ccs', FileChangeType.Deleted);
        const broken = await client.waitForDiagnostics('/project/main.ccs', d => d.length > 0);
        expect(messages(broken)).toEqual(["Undefined command 'helper'", 'Cannot resolve import: lib.ccs']);
        // The import error is on the import's path
        expect(broken[1].range).toEqual(Range.create(0, 7, 0, 10));

        client.fs.addFile('/project/lib.ccs', 'command helper() { }');
        await client.fileChanged('/project/lib.ccs', FileChangeType.Created);
        expect(await client.waitForDiagnostics('/project/main.ccs', d => d.length === 0)).toEqual([]);
    });

    it('reloads files changed on disk that are not open', async () => {
        client = await TestClient.start({
            files: {
                '/project/lib.ccs': 'command helper() { }',
                '/project/main.ccs': 'import lib\ncommand main() { helper() }',
            },
        });
        await client.open('/project/main.ccs');
        await client.waitForDiagnostics('/project/main.ccs');

        client.fs.addFile('/project/lib.ccs', 'command other() { }');
        await client.fileChanged('/project/lib.ccs', FileChangeType.Changed);
        expect(messages(await client.waitForDiagnostics('/project/main.ccs', d => d.length > 0)))
            .toEqual(["Undefined command 'helper'"]);
    });

    it('publishes diagnostics when files load slowly (as from a real disk)', async () => {
        // Opening a file loads its whole directory; validation can run before that finishes
        const files: Record<string, string> = { '/project/main.ccs': 'command main() { next nope }' };
        for (let i = 0; i < 20; i++) {
            files[`/project/sibling_${i}.ccs`] = `command c${i}() { next }`;
        }
        client = await TestClient.start({ files, readDelay: 5 });
        await client.open('/project/main.ccs');
        expect(messages(await client.waitForDiagnostics('/project/main.ccs'))).toEqual(["Undefined identifier 'nope'"]);
    });

    it('reports files that can\'t be loaded', async () => {
        client = await TestClient.start({
            files: { '/project/a/util.ccs': 'command a() { }', '/project/b/util.ccs': 'command b() { }' },
        });
        await client.open('/project/a/util.ccs');
        await client.waitForDiagnostics('/project/a/util.ccs');
        await client.open('/project/b/util.ccs');
        expect(messages(await client.waitForDiagnostics('/project/b/util.ccs')))
            .toEqual(["Module name collision: 'util' already loaded from /project/a/util.ccs"]);
    });

    it('warns once when the standard library is not configured', async () => {
        client = await TestClient.start({ stdLib: false, files: { '/project/main.ccs': 'command main() { next }' } });
        await client.open('/project/main.ccs');
        await client.waitForDiagnostics('/project/main.ccs');
        await client.change('/project/main.ccs', 'command main() { next eob }');
        await client.waitForDiagnostics('/project/main.ccs');

        expect(client.messages).toHaveLength(1);
        expect(client.messages[0]).toContain('ccscript.stdLibPath');
    });

    it('picks up a changed standard library setting', async () => {
        client = await TestClient.start({ stdLib: false, files: { '/project/main.ccs': 'command main() { next }' } });
        await client.open('/project/main.ccs');
        expect(await client.waitForDiagnostics('/project/main.ccs')).toHaveLength(1);

        client.fs.addFile('/project/stdlib/std.ccs', 'command next "[03]"');
        client.fs.addFile('/project/stdlib/stdarg.ccs', '');
        await client.connection.sendNotification('workspace/didChangeConfiguration', {
            settings: { ccscript: { stdLibPath: '${workspaceFolder}/stdlib' } },
        });
        expect(await client.waitForDiagnostics('/project/main.ccs', d => d.length === 0)).toEqual([]);
    });
});

describe('Stress', () => {
    function createRandom(seed: number): () => number {
        return () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
    }

    const fixturesDir = path.join(__dirname, '..', '..', '..', 'ccscript-core', 'src', 'test', 'fixtures');
    const fragments = ['"', '{', '}', '(', ')', ',', '.', '\n', ' ', 'helper(', 'lib.', 'command x() ', 'define Y = ', '//', '/*', 'label:'];

    it('survives random edits interleaved with every kind of request', async () => {
        const source = fs.readFileSync(path.join(fixturesDir, '12-comprehensive.ccs'), 'utf-8');
        client = await TestClient.start({
            files: {
                '/project/lib.ccs': '// Helps\ncommand helper(a, b) { }\ndefine MAX = 3',
                '/project/main.ccs': `import lib\n${source}`,
            },
            readDelay: 1,
        });
        await client.open('/project/main.ccs');

        const random = createRandom(42);
        const lineCount = () => client.text('/project/main.ccs').split('\n').length;
        const randomPosition = () => {
            const lines = client.text('/project/main.ccs').split('\n');
            const line = Math.floor(random() * lines.length);
            return Position.create(line, Math.floor(random() * (lines[line].length + 1)));
        };
        const requests = [
            'textDocument/hover', 'textDocument/completion', 'textDocument/signatureHelp', 'textDocument/definition',
            'textDocument/references', 'textDocument/documentHighlight', 'textDocument/documentSymbol',
            'textDocument/semanticTokens/full', 'textDocument/foldingRange', 'textDocument/documentLink',
            'textDocument/codeAction',
        ];

        const pending: Promise<unknown>[] = [];
        for (let i = 0; i < 300; i++) {
            const start = randomPosition();
            const deleteEnd = random() < 0.5 ? start : Position.create(start.line, start.character + Math.floor(random() * 5));
            const lines = client.text('/project/main.ccs').split('\n');
            const end = Position.create(deleteEnd.line, Math.min(deleteEnd.character, lines[deleteEnd.line].length));
            const insert = random() < 0.6 ? fragments[Math.floor(random() * fragments.length)] : '';
            void client.edit('/project/main.ccs', Range.create(start, end), insert);

            const method = requests[Math.floor(random() * requests.length)];
            const position = randomPosition();
            const extra = method === 'textDocument/references' ? { context: { includeDeclaration: true } }
                : method === 'textDocument/codeAction' ? { range: Range.create(position, position), context: { diagnostics: [] } }
                    : {};
            const usesPosition = !['textDocument/documentSymbol', 'textDocument/semanticTokens/full',
                'textDocument/foldingRange', 'textDocument/documentLink', 'textDocument/codeAction'].includes(method);
            pending.push(client.request(method, '/project/main.ccs', usesPosition ? position : undefined, extra));

            if (i % 25 === 0) {
                pending.push(client.request('workspace/symbol', '/project/main.ccs', undefined, { query: 'he' }));
            }
            expect(lineCount()).toBeGreaterThan(0);
        }

        // Every request completes without an error response
        const results = await Promise.allSettled(pending);
        const failures = results.filter(r => r.status === 'rejected');
        expect(failures).toEqual([]);

        // And the final diagnostics match a fresh server's for the same text
        const finalDiagnostics = await client.waitForDiagnostics('/project/main.ccs');
        const finalText = client.text('/project/main.ccs');
        client.dispose();

        client = await TestClient.start({
            files: { '/project/lib.ccs': '// Helps\ncommand helper(a, b) { }\ndefine MAX = 3', '/project/main.ccs': finalText },
        });
        await client.open('/project/main.ccs');
        expect(finalDiagnostics).toEqual(await client.waitForDiagnostics('/project/main.ccs'));
    });
});
