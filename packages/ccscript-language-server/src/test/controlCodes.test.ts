import { Hover, InlayHint, MarkupContent, Range } from 'vscode-languageserver-protocol';
import { TestClient, positionOf, textInRange } from './testClient';

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
