import { CodeAction, CodeActionKind, Hover, InlayHint, MarkupContent, Position, Range, TextEdit } from 'vscode-languageserver-protocol';
import { TestClient, positionOf, textInRange, uri } from './testClient';

const STD = {
    'std.ccs': [
        '// Prints an item\'s name',
        'command itemname(item) "[1C 05 {byte item}]"',
        'command name(char) "[1C 02 {byte char}]"',
        'command boost_exp(char,n) "[1E 09 {byte char} {byte[0] n} {byte[1] n} {byte[2] n}]"',
        'command call(target) "[08 {long target}]"',
        'command next "[03]"',
        'command window_open(n) {',
        '    "[18 01 {byte n}]"',
        '}',
    ].join('\n'),
    'stdarg.ccs': '',
};

const FILES = {
    '/project/Project.snake': '',
    '/project/item_configuration_table.yml': '1:\n  Name: Franklin badge\n2:\n  Name: Cracked bat\n',
    '/project/dont_care_names.yml': '0:\n  Name 1: Ness\n2:\n  Name 1: Jeff\n',
    '/project/ccscript/missing.ccs': 'command party_member_name(member) "[1C 02 {byte member}]"\ncommand wait_for_movement "[1F 61]"\n',
};

let client: TestClient;
afterEach(() => client?.dispose());

const PATH = '/project/ccscript/main.ccs';

async function hover(text: string, search: string, delta = 0): Promise<{ value: string; range?: Range }> {
    client = await TestClient.start({ files: { ...FILES, [PATH]: text }, stdLib: STD });
    await client.open(PATH);
    const result = await client.request<Hover | null>('textDocument/hover', PATH, positionOf(text, search, 0, delta));
    return { value: (result?.contents as MarkupContent | undefined)?.value ?? '', range: result?.range };
}

describe('Control code hover', () => {
    it('decodes a code into the command that produces it, with what its arguments mean', async () => {
        const text = 'intro: "You got the [1C 05 02]!"\n';
        const { value, range } = await hover(text, '05');
        expect(value).toContain('```ccscript\nitemname(2)\n```');
        expect(value).toContain('Item 2: **Cracked bat**');
        expect(value).toContain("Prints an item's name");
        expect(value).toContain('`1C 05 02` · `command itemname(item) "[1C 05 {byte item}]"` from the standard library');
        expect(textInRange(text, range!)).toBe('1C 05 02');
    });

    it('splits a group into codes and describes the one under the cursor', async () => {
        const text = 'intro: "[1C 05 01 03 1F 61]"\n';
        expect((await hover(text, '01')).value).toContain('itemname(1)');

        const next = await hover(text, '03');
        expect(next.value).toContain('```ccscript\nnext\n```');
        expect(textInRange(text, next.range!)).toBe('03');

        const movement = await hover(text, '61');
        expect(movement.value).toContain('wait_for_movement');
        expect(movement.value).toContain('from missing.ccs');
    });

    it('assembles multi-byte arguments', async () => {
        expect((await hover('intro: "[1E 09 01 10 27 00]"\n', '27')).value).toContain('boost_exp(1, 10000)');
        expect((await hover('intro: "[08 11 37 C5 00]"\n', '08')).value).toContain('call(0xC53711)');
    });

    it('lists other commands that produce the same code', async () => {
        const { value } = await hover('intro: "[1C 02 01]"\n', '1C');
        expect(value).toContain('```ccscript\nname(1)\n```');
        expect(value).toContain('Also produced by `party_member_name`');
    });

    it('says when no command produces a code, or it isn\'t one', async () => {
        expect((await hover('intro: "[19 02]"\n', '19')).value).toBe('`19 02` · no loaded command produces this control code');
        expect((await hover('intro: "[AC 03]"\n', 'AC')).value).toBe('`AC` · raw text byte, not a control code');
    });

    it('reads placeholders written as calls', async () => {
        const text = 'command make_sprite(id, style) "[1F 15 {short(id)} {byte(style)}]"\nintro: "[1F 15 B9 01 03]"\n';
        expect((await hover(text, 'B9')).value).toContain('make_sprite(441, 3)');
    });

    it('ignores codes it can\'t read, and plain text', async () => {
        expect((await hover('command f(x) "[1C 05 {byte x}]"\n', '05')).value).toBe('');
        expect((await hover('intro: "Hello [03]"\n', 'ello')).value).toBe('');
    });

    it('ignores machine code macros, even for bytes in the control code range', async () => {
        // An assembler file defines opcodes across 00-FF, some of which overlap control codes
        const asm = 'command DEY "[88]"\ncommand PHD "[0B]"\n';
        client = await TestClient.start({ files: { ...FILES, '/project/ccscript/asm.ccs': asm, [PATH]: 'import asm\nintro: "[0B][88]"\n' }, stdLib: STD });
        await client.open(PATH);
        for (const search of ['0B', '88']) {
            const result = await client.request<Hover | null>('textDocument/hover', PATH, positionOf(client.text(PATH), search));
            expect((result?.contents as MarkupContent).value).not.toMatch(/PHD|DEY/);
        }
    });

    it('only uses commands whose body is entirely control codes', async () => {
        // window_open's body is a block, so it isn't a pattern
        expect((await hover('intro: "[18 01 02]"\n', '18')).value).toContain('no loaded command');
    });
});

describe('Control code inlay hints', () => {
    async function hints(text: string, path = PATH): Promise<{ label: string; character: number; tooltip: string }[]> {
        client = await TestClient.start({ files: { ...FILES, [PATH]: text }, stdLib: STD });
        await client.open(path);
        const lines = client.text(path).split('\n');
        const result = await client.request<InlayHint[]>('textDocument/inlayHint', path, undefined, {
            range: Range.create(0, 0, lines.length, 0),
        });
        return result.map(h => ({
            label: h.label as string,
            character: h.position.character,
            tooltip: (h.tooltip as MarkupContent | undefined)?.value ?? '',
        }));
    }

    it('shows the commands each group encodes, naming game data', async () => {
        const text = 'intro: "Hi [1C 02 03] and [03][1F 61]!"\n';
        const result = await hints(text);
        expect(result.map(h => [h.label, h.character])).toEqual([
            ['name(Jeff)', text.indexOf('] and') + 1],
            ['next', text.indexOf('][1F') + 1],
            ['wait_for_movement', text.indexOf(']!') + 1],
        ]);
        expect(result[0].tooltip).toBe('- `1C 02 03` · `name(3)`');
    });

    it('shows several codes in one group, marking unknown ones', async () => {
        expect((await hints('intro: "[1C 05 02 19 02 03]"\n')).map(h => h.label)).toEqual(['itemname(Cracked bat) … next']);
    });

    it('shows nothing for unknown codes, raw text bytes, or a command\'s own definition', async () => {
        expect(await hints('intro: "[19 02][AC]"\n')).toEqual([]);
        expect(await hints('intro: "x"\n', '/project/ccscript/missing.ccs')).toEqual([]);
    });

    it('can be turned off', async () => {
        client = await TestClient.start({ files: { ...FILES, [PATH]: 'intro: "[03]"\n' }, stdLib: STD });
        await client.connection.sendNotification('workspace/didChangeConfiguration', {
            settings: { ccscript: { stdLibPath: '/lib', inlayHints: { controlCodes: false } } },
        });
        await client.open(PATH);
        await client.waitForDiagnostics(PATH);
        expect(await client.request<InlayHint[]>('textDocument/inlayHint', PATH, undefined, { range: Range.create(0, 0, 2, 0) })).toEqual([]);
    });
});

describe('Converting control codes to commands', () => {
    function apply(text: string, edits: TextEdit[]): string {
        const lines = text.split('\n');
        const offset = (p: Position) => lines.slice(0, p.line).reduce((sum, l) => sum + l.length + 1, 0) + p.character;
        return [...edits]
            .sort((a, b) => offset(b.range.start) - offset(a.range.start))
            .reduce((result, e) => result.slice(0, offset(e.range.start)) + e.newText + result.slice(offset(e.range.end)), text);
    }

    async function convertAt(text: string, search: string, path = PATH): Promise<string | undefined> {
        client = await TestClient.start({ files: { ...FILES, [PATH]: text }, stdLib: STD });
        await client.open(path);
        const position = positionOf(client.text(path), search);
        const actions = await client.request<CodeAction[]>('textDocument/codeAction', path, undefined, {
            range: Range.create(position, position),
            context: { diagnostics: [] },
        });
        const convert = actions.find(a => a.kind === CodeActionKind.RefactorRewrite);
        return convert && apply(client.text(path), convert.edit!.changes![uri(path)]);
    }

    it('converts the group under the cursor, preferring the standard library', async () => {
        expect(await convertAt('intro: "Hi [1C 02 03] and [03]!"\n', '02 03'))
            .toBe('intro: "Hi {name(3)} and [03]!"\n');
    });

    it('keeps codes no command produces as raw bytes', async () => {
        expect(await convertAt('intro: "[1C 05 02 19 02 03]"\n', '1C'))
            .toBe('intro: "{itemname(2)}[19 02]{next}"\n');
    });

    it('imports the module of a command the file doesn\'t see', async () => {
        expect(await convertAt('intro: "[1F 61]"\n', '1F')).toBe('import "missing.ccs"\nintro: "{wait_for_movement}"\n');
        expect(await convertAt('import missing\nintro: "[1F 61]"\n', '1F')).toBe('import missing\nintro: "{wait_for_movement}"\n');
    });

    it('qualifies the command instead when importing would change what names mean', async () => {
        // The file has its own wait_for_movement
        expect(await convertAt('wait_for_movement:\nintro: "[1F 61]"\n', '1F'))
            .toBe('wait_for_movement:\nintro: "{missing.wait_for_movement}"\n');

        // The file uses party_member_name from another import, which would become ambiguous
        const tools = { '/project/ccscript/tools.ccs': 'define party_member_name = 5\n' };
        const text = 'import tools\nintro: party_member_name "[1F 61]"\n';
        client = await TestClient.start({ files: { ...FILES, ...tools, [PATH]: text }, stdLib: STD });
        await client.open(PATH);
        const position = positionOf(text, '1F');
        const actions = await client.request<CodeAction[]>('textDocument/codeAction', PATH, undefined, {
            range: Range.create(position, position), context: { diagnostics: [] },
        });
        const convert = actions.find(a => a.kind === CodeActionKind.RefactorRewrite)!;
        expect(apply(text, convert.edit!.changes![uri(PATH)])).toBe('import tools\nintro: party_member_name "{missing.wait_for_movement}"\n');
    });

    it('reassembles multi-byte arguments', async () => {
        expect(await convertAt('intro: "[1E 09 01 10 27 00][08 11 37 C5 00]"\n', '1E'))
            .toBe('intro: "{boost_exp(1, 10000)}[08 11 37 C5 00]"\n');
        expect(await convertAt('intro: "[08 11 37 C5 00]"\n', '08')).toBe('intro: "{call(0xC53711)}"\n');
    });

    it('leaves command definitions alone, but converts strings in command bodies', async () => {
        client = await TestClient.start({ files: FILES, stdLib: STD });
        await client.open('/project/ccscript/missing.ccs');
        const position = positionOf(client.text('/project/ccscript/missing.ccs'), '1F 61');
        const actions = await client.request<CodeAction[]>('textDocument/codeAction', '/project/ccscript/missing.ccs', undefined, {
            range: Range.create(position, position), context: { diagnostics: [] },
        });
        expect(actions.filter(a => a.kind === CodeActionKind.RefactorRewrite)).toEqual([]);
        client.dispose();

        expect(await convertAt('command greet() {\n    "Hi[03]"\n}\n', '03')).toBe('command greet() {\n    "Hi{next}"\n}\n');
    });

    it('offers nothing for groups with no known codes', async () => {
        expect(await convertAt('intro: "[19 02]"\n', '19')).toBeUndefined();
    });

    it('converts a whole file when the source action is chosen', async () => {
        const text = 'intro: "Hi [1C 02 03]! [03][19 02]"\n    "[1F 61]" next\n';
        client = await TestClient.start({ files: { ...FILES, [PATH]: text }, stdLib: STD });
        await client.open(PATH);
        const actions = await client.request<CodeAction[]>('textDocument/codeAction', PATH, undefined, {
            range: Range.create(0, 0, 0, 0),
            context: { diagnostics: [], only: [CodeActionKind.Source] },
        });
        expect(actions.map(a => a.title)).toEqual(['Convert all control codes in this file to commands']);
        expect(actions[0].edit).toBeUndefined(); // Computed on resolve

        const resolved = await client.connection.sendRequest<CodeAction>('codeAction/resolve', actions[0]);
        const converted = apply(text, resolved.edit!.changes![uri(PATH)]);
        expect(converted).toBe('import "missing.ccs"\nintro: "Hi {name(3)}! {next}[19 02]"\n    "{wait_for_movement}" next\n');

        // The result is valid
        await client.change(PATH, converted);
        expect(await client.waitForDiagnostics(PATH)).toEqual([]);
    });
});

describe('Converting a whole file', () => {
    it('skips strings that look like binary data', async () => {
        const text = [
            'intro: "Hi[03]"',
            'table:',
            '    "[00 00 00 00 00 00]"', // Repeated codes
            '    "[00 00]"', // One code repeated
            '    "[03 AC 2F 01]"', // Bytes no command produces
            '    "[1F 61][03]"', // Script-like: converted
            '    "[03 02][02][A3 A4]"', // Another group has bytes no command produces
            'title: "Mom[00]"', // A terminator
            'command f(x) "[0E {byte x}]"',
            'other: f("[03]")', // An argument
            'ROM[0xC00000] = "[03]"', // Written to the ROM
            '',
        ].join('\n');
        client = await TestClient.start({ files: { ...FILES, '/project/ccscript/main.ccs': text }, stdLib: { ...STD, 'std.ccs': `${STD['std.ccs']}\ncommand linebreak "[00]"` } });
        await client.open('/project/ccscript/main.ccs');
        const [action] = await client.request<CodeAction[]>('textDocument/codeAction', '/project/ccscript/main.ccs', undefined, {
            range: Range.create(0, 0, 0, 0), context: { diagnostics: [], only: [CodeActionKind.Source] },
        });
        const resolved = await client.connection.sendRequest<CodeAction>('codeAction/resolve', action);
        expect(resolved.edit!.changes![uri('/project/ccscript/main.ccs')].map(e => e.newText))
            .toEqual(['{next}', '{wait_for_movement}', '{next}', 'import "missing.ccs"\n']);
    });
});
