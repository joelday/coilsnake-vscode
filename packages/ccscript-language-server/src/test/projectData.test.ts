/**
 * Reference data from a CoilSnake project: inlay hints, hover, completion and navigation for
 * the numbers and labels that refer to it.
 */

import {
    CompletionItem,
    CompletionTriggerKind,
    FileChangeType,
    Hover,
    InlayHint,
    Location,
    MarkupContent,
    Position,
    Range,
} from 'vscode-languageserver-protocol';
import { parseSummary, parseTable } from '../projectData';
import { TestClient, positionOf, uri } from './testClient';

const ITEMS = `0:
  Help Text Pointer: data_02.l_0xc539c4
  Name: 'Null'
1:
  Cost: 0
  Help Text Pointer: data_02.l_0xc53711
  Name: Franklin badge
2:
  Cost: 18
  Help Text Pointer: data_02.l_0xc53750
  Name: Cracked bat
`;

const PROJECT_FILES: Record<string, string> = {
    '/project/Project.snake': 'resources: {}\n',
    '/project/item_configuration_table.yml': ITEMS,
    '/project/psi_name_table.yml': "0:\n  Name: PK(????)\n1:\n  Name: 'PK Fire '\n",
    '/project/dont_care_names.yml': '0:\n  Name 1: Ness\n  Name 2: Alec\n1:\n  Name 1: Paula\n4:\n  Name 1: King\n',
    '/project/npc_config_table.yml': '5:\n  Direction: down\n  Text Pointer 1: data_02.l_greeting\n  Type: person\n',
    '/project/teleport_destination_table.yml': '0: {Direction: 0, X: 0, Y: 0, EBME_Comment: null}\n1: {Direction: 5, X: 904, Y: 1001, EBME_Comment: Onett}\n',
    '/project/ccscript/summary.txt': [
        'out.smc', 'CCScript Compilation Summary', '', 'Label locations',
        'Labels in module data_02',
        'Name                         Address',
        '-----------------------------------------------------------------',
        'l_0xc53711                   $c53711',
        '-----------------------------------------------------------------', '',
    ].join('\n'),
    '/project/ccscript/data_02.ccs': [
        'l_0xc53711:',
        '    "@The Franklin badge.[03]" next',
        'l_greeting:',
        '    "@Hi there, [1C 02 01]! How are you today, my friend?" next',
    ].join('\n'),
    '/project/ccscript/asm.ccs': 'define Smash = 0xC2AB79\n',
};

const STD = {
    'std.ccs': [
        'command give(character,item) "[1D 00 {byte character} {byte item}]"',
        'command psiname(psi) "[1C 12 {byte psi}]"',
        'command sprite_direction(tpt, dir) "[1F 16 {short tpt} {byte dir}]"',
        'command warp(dest) "[1F 21 {byte dest}]"',
        'command call(target) "[08 {long target}]"',
        'command next "[03]"',
    ].join('\n'),
    'stdarg.ccs': '',
};

const MAIN = `import asm
intro:
    give(1, 2) psiname(1)
    sprite_direction(5, 1) warp(1)
    call(0xC2AB79) call(0xC2AB7A)
    data_02.l_0xc53711
`;

let client: TestClient;
afterEach(() => client?.dispose());

async function startProject(main = MAIN): Promise<void> {
    client = await TestClient.start({ files: { ...PROJECT_FILES, '/project/ccscript/main.ccs': main }, stdLib: STD });
    await client.open('/project/ccscript/main.ccs');
}

const MAIN_PATH = '/project/ccscript/main.ccs';
const at = (search: string, occurrence = 0, delta = 0) => positionOf(client.text(MAIN_PATH), search, occurrence, delta);

async function inlayHints(path = MAIN_PATH): Promise<{ line: number; character: number; label: string }[]> {
    const lines = client.text(path).split('\n');
    const hints = await client.request<InlayHint[]>('textDocument/inlayHint', path, undefined, {
        range: Range.create(0, 0, lines.length, 0),
    });
    return hints.map(h => ({ line: h.position.line, character: h.position.character, label: h.label as string }));
}

describe('Loading the build', () => {
    it('loads what a CoilSnake build compiles, so qualified references resolve as they would', async () => {
        client = await TestClient.start({
            files: {
                '/project/Project.snake': '',
                '/project/ccscript/main.ccs': 'import "shops/ShopMain.ccs"\n',
                '/project/ccscript/shops/ShopMain.ccs': 'l_shop:\n    "Welcome!" next\n',
                '/project/ccscript/data/data_05.ccs': 'intro: call(ShopMain.l_shop) call(Unbuilt.l_x)\n',
                '/project/ccscript/unused/Unbuilt.ccs': 'l_x:\n',
            },
            stdLib: STD,
        });
        await client.open('/project/ccscript/data/data_05.ccs');
        const diagnostics = await client.waitForDiagnostics('/project/ccscript/data/data_05.ccs');
        // ShopMain is part of the build; Unbuilt isn't (nothing imports it), so a build wouldn't find it
        expect(diagnostics.map(d => d.message)).toEqual(["Unknown module 'Unbuilt'"]);
    });
});

describe('Reading project files', () => {
    it('reads block and inline table entries', () => {
        const table = parseTable('/t.yml', "0:\n  Name: 'It''s'\n  Cost: 3\n0x02: {X: 1, EBME_Comment: Onett}\n");
        expect(table.entries.get(0)!.fields).toEqual({ Name: "It's", Cost: '3' });
        expect(table.entries.get(2)!.fields).toEqual({ X: '1', EBME_Comment: 'Onett' });
        expect(table.entries.get(2)!.line).toBe(3);
    });

    it('reads label addresses from a build summary', () => {
        expect(parseSummary(PROJECT_FILES['/project/ccscript/summary.txt'])).toEqual(new Map([['data_02.l_0xc53711', 0xC53711]]));
    });
});

describe('Inlay hints', () => {
    it('names parameters and what literal arguments refer to', async () => {
        await startProject();
        const hints = await inlayHints();
        const line2 = hints.filter(h => h.line === 2).map(h => h.label);
        expect(line2).toEqual(['character:', 'Ness', 'item:', 'Cracked bat', 'PK Fire']);

        const line3 = hints.filter(h => h.line === 3).map(h => h.label);
        expect(line3).toEqual(['tpt:', '“Hi there, ! How are you today, my frien…”', 'dir:', 'Onett']);
    });

    it('doesn\'t name 0, which usually means the current value', async () => {
        await startProject(MAIN.replace('give(1, 2)', 'give(0, 0)'));
        expect((await inlayHints()).filter(h => h.line === 2).map(h => h.label)).toEqual(['character:', 'item:', 'PK Fire']);
    });

    it('places value hints after the literal', async () => {
        await startProject();
        const hints = await inlayHints();
        const ness = hints.find(h => h.label === 'Ness')!;
        expect(ness).toMatchObject(at('1, 2', 0, 1));
    });

    it('names addresses that a constant defines', async () => {
        await startProject();
        const hints = await inlayHints();
        expect(hints.filter(h => h.line === 4).map(h => h.label)).toEqual(['= Smash']);
        // But not on the definition itself
        expect(await inlayHints('/project/ccscript/asm.ccs').catch(() => [])).toEqual([]);
    });

    it('shows which table entries use a label\'s text', async () => {
        await startProject();
        await client.open('/project/ccscript/data_02.ccs');
        const hints = (await inlayHints('/project/ccscript/data_02.ccs')).filter(h => h.label.startsWith('←'));
        expect(hints.map(h => h.label)).toEqual(['← Item 1 Franklin badge', '← NPC 5']);
        expect(hints[0]).toMatchObject({ line: 0, character: 'l_0xc53711:'.length });
    });

    it('can be turned off by kind', async () => {
        await startProject();
        await client.connection.sendNotification('workspace/didChangeConfiguration', {
            settings: { ccscript: { stdLibPath: '/lib', inlayHints: { parameterNames: false, values: false } } },
        });
        await client.waitForDiagnostics(MAIN_PATH);
        expect(await inlayHints()).toEqual([]);
    });

    it('updates when project tables change', async () => {
        await startProject();
        client.fs.addFile('/project/item_configuration_table.yml', ITEMS.replace('Cracked bat', 'Sand lot bat'));
        await client.fileChanged('/project/item_configuration_table.yml', FileChangeType.Changed);
        await client.waitForDiagnostics(MAIN_PATH);
        expect((await inlayHints()).map(h => h.label)).toContain('Sand lot bat');
    });
});

describe('Hover', () => {
    const hover = async (position: Position) =>
        ((await client.request<Hover>('textDocument/hover', MAIN_PATH, position))?.contents as MarkupContent | undefined)?.value ?? '';

    it('explains literal arguments, linking to their table entry', async () => {
        await startProject();
        const text = await hover(at('2) psiname'));
        expect(text).toContain('**2** · `0x2`');
        expect(text).toContain('Item 2: **Cracked bat**');
        expect(text).toContain(`(${uri('/project/item_configuration_table.yml')}#L8)`);
    });

    it('explains addresses', async () => {
        await startProject();
        const text = await hover(at('0xC2AB79'));
        expect(text).toContain('**12757881** · `0xC2AB79`');
        expect(text).toContain('file offset `0x2AB79`');
        expect(text).toContain('Same value as `Smash`');
    });

    it('shows where labels compiled to and which tables use them', async () => {
        await startProject();
        const text = await hover(at('l_0xc53711'));
        expect(text).toContain('Compiled to `$C53711` (last build)');
        expect(text).toContain(`[Item 1](${uri('/project/item_configuration_table.yml')}#L6) · Help Text Pointer`);
    });

    it('shows constants\' values in both bases', async () => {
        await startProject('import asm\nintro: call(Smash)\n');
        expect(await hover(at('Smash'))).toContain('**12757881** · `0xC2AB79` · ROM address');
    });
});

describe('Completion', () => {
    it('offers game data by name for arguments that take it, inserting the number', async () => {
        await startProject(MAIN.replace('give(1, 2)', 'give(1, )'));
        const items = await client.request<CompletionItem[]>('textDocument/completion', MAIN_PATH, at('give(1, ', 0, 8));
        const named = items.filter(i => i.detail?.startsWith('Item '));
        expect(named.map(i => [i.label, i.insertText])).toEqual([['Null', '0'], ['Franklin badge', '1'], ['Cracked bat', '2']]);
        expect(items[0].label).toBe('Null');
    });

    it('only offers game data when "(" or "," is typed', async () => {
        await startProject(MAIN.replace('give(1, 2)', 'give(1, 2) next('));
        const items = await client.request<CompletionItem[]>('textDocument/completion', MAIN_PATH, at('next(', 0, 5), {
            context: { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: '(' },
        });
        expect(items).toEqual([]);

        const characters = await client.request<CompletionItem[]>('textDocument/completion', MAIN_PATH, at('give(', 0, 5), {
            context: { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: '(' },
        });
        expect(characters.map(i => i.label)).toEqual(['Ness', 'Paula']);
    });
});

describe('Navigation', () => {
    it('goes from a literal argument to its table entry', async () => {
        await startProject();
        const location = await client.request<Location>('textDocument/definition', MAIN_PATH, at('2) psiname'));
        expect(location).toEqual(Location.create(uri('/project/item_configuration_table.yml'), Range.create(7, 0, 7, 0)));
    });

    it('includes table entries in a label\'s references', async () => {
        await startProject();
        const locations = await client.request<Location[]>('textDocument/references', MAIN_PATH, at('l_0xc53711'), {
            context: { includeDeclaration: false },
        });
        expect(locations.map(l => `${l.uri.replace(/^.*\//, '')}:${l.range.start.line}`)).toEqual([
            'main.ccs:5',
            'item_configuration_table.yml:5',
        ]);
    });
});
