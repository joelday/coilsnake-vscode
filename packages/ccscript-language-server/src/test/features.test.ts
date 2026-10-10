import {
    CodeAction,
    CompletionItem,
    DocumentLink,
    DocumentHighlight,
    DocumentHighlightKind,
    DocumentSymbol,
    FoldingRange,
    Hover,
    Location,
    MarkupContent,
    Range,
    SemanticTokens,
    SignatureHelp,
    SymbolInformation,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver-protocol';
import { semanticTokensLegend } from '../features/semanticTokens';
import { TestClient, positionOf, textInRange, uri, withCursor } from './testClient';

const TEXT = `// Prints a party member's name
// (0 is the first member)
command party_name(member) "[1C 02 {byte member}]"

/* Gives an item
   to a character */
command give(item, character) "[1D 0E {byte character} {byte item}]"

define MAX_LEVEL = 99 // The level cap
`;

const MAIN = `import "lib/text.ccs"

define LV = MAX_LEVEL

command greet(who, times) {
    party_name(who)
    next
    start:
    goto(start)
}

intro:
    "Hello" greet(1, 2) text.give(3, 1) next
    eob
`;

let client: TestClient;

async function startProject(main = MAIN, extraFiles: Record<string, string> = {}): Promise<void> {
    client = await TestClient.start({
        files: { '/project/lib/text.ccs': TEXT, '/project/main.ccs': main, ...extraFiles },
    });
    await client.open('/project/main.ccs');
}

const at = (search: string, occurrence = 0, delta = 0) => positionOf(client.text('/project/main.ccs'), search, occurrence, delta);
const hoverText = (hover: Hover | null) => (hover?.contents as MarkupContent | undefined)?.value ?? '';

afterEach(() => client?.dispose());

describe('Diagnostics', () => {
    it('reports nothing for a valid project', async () => {
        await startProject();
        expect(await client.waitForDiagnostics('/project/main.ccs')).toEqual([]);
    });
});

describe('Completion', () => {
    async function complete(textWithCursor: string): Promise<CompletionItem[]> {
        const { text, position } = withCursor(textWithCursor);
        await startProject(text);
        return client.request<CompletionItem[]>('textDocument/completion', '/project/main.ccs', position);
    }

    it('offers parameters, labels, own and imported declarations, std lib, modules and keywords', async () => {
        const items = await complete(MAIN.replace('    next\n    start:', '    |\n    next\n    start:'));
        const labels = items.map(i => i.label);
        for (const expected of ['who', 'times', 'start', 'greet', 'LV', 'intro', 'party_name', 'give', 'MAX_LEVEL', 'next', 'goto', 'text', 'command', 'ROM']) {
            expect(labels).toContain(expected);
        }
        // Locals sort first, keywords last
        const sorted = [...items].sort((a, b) => a.sortText!.localeCompare(b.sortText!));
        expect(sorted[0].label).toMatch(/^(who|times|start)$/);
        expect(sorted[sorted.length - 1].label).not.toMatch(/^(who|greet|next)$/);
    });

    it('inserts commands with parameters as snippets and documents them', async () => {
        const items = await complete(MAIN.replace('    next\n    start:', '    |\n    next\n    start:'));
        const partyName = items.find(i => i.label === 'party_name')!;
        expect(partyName.insertText).toBe('party_name(${1:member})');
        expect(partyName.detail).toBe('command party_name(member) "[1C 02 {byte member}]"');
        expect((partyName.documentation as MarkupContent).value).toContain("Prints a party member's name");
        expect(items.find(i => i.label === 'next')!.insertText).toBeUndefined();
    });

    it('ranks what fits the parameter being filled first', async () => {
        const main = `import "lib/text.ccs"
define MEMBER_COUNT = 4
define LIMIT = 9

command greet(member, times) {
    party_name(|)
}

intro:
    "Hi"
`;
        const items = await complete(main);
        const sorted = [...items].sort((a, b) => a.sortText!.localeCompare(b.sortText!));
        // Names matching the parameter, then constants and parameters, then the rest
        expect(sorted.slice(0, 2).map(i => i.label).sort()).toEqual(['MEMBER_COUNT', 'member']);
        expect(sorted.find(i => i.label === 'member')!.preselect).toBe(true);
        expect(sorted.slice(2, 5).map(i => i.label).sort()).toEqual(['LIMIT', 'MAX_LEVEL', 'times']);
        expect(sorted[0].labelDetails?.description).toBe('for member');
        // Only keywords that can start an expression
        const keywords = items.filter(i => i.kind === 14).map(i => i.label);
        expect(keywords).toContain('flag');
        expect(keywords).not.toContain('command');
    });

    it('ranks labels first for pointer parameters', async () => {
        const items = await complete(MAIN.replace('goto(start)', 'goto(|)'));
        const sorted = [...items].sort((a, b) => a.sortText!.localeCompare(b.sortText!));
        expect(sorted.slice(0, 2).map(i => i.label).sort()).toEqual(['intro', 'start']);
        expect(sorted[0].labelDetails?.description).toBe('for target');
    });

    it('doesn\'t insert a call snippet where a parenthesis already follows', async () => {
        const items = await complete(MAIN.replace('party_name(who)', 'party_na|(who)'));
        expect(items.find(i => i.label === 'party_name')!.insertText).toBeUndefined();
    });

    it('offers a module\'s members after a dot', async () => {
        const items = await complete(MAIN.replace('text.give(3, 1)', 'text.|'));
        expect(items.map(i => i.label).sort()).toEqual(['MAX_LEVEL', 'give', 'party_name']);
    });

    it('offers nothing in comments or string text', async () => {
        expect(await complete(`// a com|ment\n${MAIN}`)).toEqual([]);
        expect(await complete(MAIN.replace('"Hello"', '"Hel|lo"'))).toEqual([]);
    });

    it('offers code completions inside string templates', async () => {
        const items = await complete(MAIN.replace('"Hello"', '"Hi {party_name(|)}"'));
        expect(items.map(i => i.label)).toContain('LV');
    });

    it('offers file paths in imports', async () => {
        const items = await complete(MAIN.replace('import "lib/text.ccs"', 'import "lib/text.ccs"\nimport "|'));
        expect(items.map(i => i.label)).toContain('lib/text.ccs');
    });
});

describe('Hover', () => {
    const hover = async (search: string, occurrence = 0) =>
        hoverText(await client.request<Hover>('textDocument/hover', '/project/main.ccs', at(search, occurrence)));

    it('shows signatures, bodies, doc comments and where symbols come from', async () => {
        await startProject();
        const partyName = await hover('party_name');
        expect(partyName).toContain('command party_name(member) "[1C 02 {byte member}]"');
        expect(partyName).toContain("Prints a party member's name\n(0 is the first member)");
        expect(partyName).toContain('from lib/text.ccs');

        expect(await hover('give')).toContain('Gives an item\nto a character');
        const maxLevel = await hover('MAX_LEVEL');
        expect(maxLevel).toContain('define MAX_LEVEL = 99');
        expect(maxLevel).toContain('The level cap');
        expect(await hover('next')).toContain('from standard library');
        expect(await hover('who', 1)).toContain('(parameter) who');
        expect(await hover('text.give')).toContain('import text');
    });

    it('shows nothing on punctuation or literals', async () => {
        await startProject();
        expect(await client.request<Hover | null>('textDocument/hover', '/project/main.ccs', at('= MAX', 0, 0))).toBeNull();
    });
});

describe('Signature help', () => {
    async function signature(textWithCursor: string): Promise<SignatureHelp | null> {
        const { text, position } = withCursor(textWithCursor);
        await startProject(text);
        return client.request<SignatureHelp | null>('textDocument/signatureHelp', '/project/main.ccs', position);
    }

    it('shows the called command and the active parameter', async () => {
        const help = (await signature(MAIN.replace('greet(1, 2)', 'greet(1, |2)')))!;
        expect(help.signatures[0].label).toBe('greet(who, times)');
        expect(help.activeParameter).toBe(1);
        expect(help.signatures[0].parameters![1].label).toEqual([11, 16]);
    });

    it('works for qualified calls, incomplete calls, and the innermost call', async () => {
        const qualified = (await signature(MAIN.replace('text.give(3, 1)', 'text.give(|3, 1)')))!;
        expect(qualified.signatures[0].label).toBe('give(item, character)');
        expect(qualified.signatures[0].documentation).toBeDefined();

        const incomplete = (await signature(MAIN.replace('greet(1, 2)', 'greet(1, |')))!;
        expect(incomplete.activeParameter).toBe(1);

        const inner = (await signature(MAIN.replace('greet(1, 2)', 'greet(party_name(|), 2)')))!;
        expect(inner.signatures[0].label).toBe('party_name(member)');
    });
});

describe('Navigation', () => {
    it('goes to definitions across files, of modules, and of import paths', async () => {
        await startProject();
        const definition = (search: string, occurrence = 0) =>
            client.request<Location | null>('textDocument/definition', '/project/main.ccs', at(search, occurrence));

        const partyName = (await definition('party_name'))!;
        expect(partyName.uri).toBe(uri('/project/lib/text.ccs'));
        expect(textInRange(TEXT, partyName.range)).toBe('party_name');
        expect(partyName.range.start.line).toBe(2);

        expect((await definition('text.give'))!.uri).toBe(uri('/project/lib/text.ccs'));
        expect((await definition('lib/text'))!.uri).toBe(uri('/project/lib/text.ccs'));

        const start = (await definition('start', 1))!;
        expect(start.range).toEqual(Range.create(at('start').line, 4, at('start').line, 9));
    });

    it('finds references, including qualified ones, with exact name ranges', async () => {
        await startProject();
        const references = await client.request<Location[]>('textDocument/references', '/project/main.ccs',
            at('give'), { context: { includeDeclaration: true } });

        const described = references.map(r => `${r.uri.replace(/^.*\//, '')}:${r.range.start.line}:` +
            textInRange(r.uri.endsWith('main.ccs') ? MAIN : TEXT, r.range)).sort();
        expect(described).toEqual(['main.ccs:12:give', 'text.ccs:6:give']);
    });

    it('highlights a symbol\'s occurrences in the document', async () => {
        await startProject();
        const highlights = await client.request<DocumentHighlight[]>('textDocument/documentHighlight', '/project/main.ccs', at('start', 1));
        expect(highlights.map(h => [textInRange(MAIN, h.range), h.kind])).toEqual([
            ['start', DocumentHighlightKind.Write],
            ['start', DocumentHighlightKind.Read],
        ]);
    });
});

describe('Rename', () => {
    function applyEdits(text: string, edits: TextEdit[]): string {
        const lines = text.split('\n');
        const offset = (line: number, character: number) =>
            lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + character;
        return [...edits]
            .sort((a, b) => offset(b.range.start.line, b.range.start.character) - offset(a.range.start.line, a.range.start.character))
            .reduce((result, edit) => result.slice(0, offset(edit.range.start.line, edit.range.start.character)) +
                edit.newText + result.slice(offset(edit.range.end.line, edit.range.end.character)), text);
    }

    it('renames across files, including qualified references', async () => {
        await startProject();
        const edit = await client.request<WorkspaceEdit>('textDocument/rename', '/project/main.ccs', at('give'), { newName: 'present' });
        expect(applyEdits(MAIN, edit.changes![uri('/project/main.ccs')])).toContain('text.present(3, 1)');
        expect(applyEdits(TEXT, edit.changes![uri('/project/lib/text.ccs')])).toContain('command present(item, character)');
    });

    it('renames parameters within their command only', async () => {
        await startProject();
        const edit = await client.request<WorkspaceEdit>('textDocument/rename', '/project/main.ccs', at('who'), { newName: 'member' });
        expect(Object.keys(edit.changes!)).toEqual([uri('/project/main.ccs')]);
        expect(applyEdits(MAIN, edit.changes![uri('/project/main.ccs')]))
            .toContain('command greet(member, times) {\n    party_name(member)');
    });

    it('refuses standard library symbols and invalid names', async () => {
        await startProject();
        await expect(client.request('textDocument/prepareRename', '/project/main.ccs', at('next')))
            .rejects.toThrow(/standard library/);
        await expect(client.request('textDocument/rename', '/project/main.ccs', at('greet'), { newName: 'if' }))
            .rejects.toThrow(/isn't a valid name/);

        const prepared = await client.request<{ range: Range; placeholder: string }>('textDocument/prepareRename', '/project/main.ccs', at('greet', 1));
        expect(prepared.placeholder).toBe('greet');
    });
});

describe('Symbols', () => {
    it('outlines the document, nesting labels under their command', async () => {
        await startProject();
        const symbols = await client.request<DocumentSymbol[]>('textDocument/documentSymbol', '/project/main.ccs');
        expect(symbols.map(s => s.name)).toEqual(['LV', 'greet', 'intro']);
        expect(symbols[1].detail).toBe('greet(who, times)');
        expect(symbols[1].children!.map(s => s.name)).toEqual(['start']);
    });

    it('finds symbols across the workspace by fuzzy match', async () => {
        await startProject();
        const symbols = await client.request<SymbolInformation[]>('workspace/symbol', '/project/main.ccs', undefined, { query: 'pn' });
        expect(symbols.map(s => s.name)).toContain('party_name');
        expect(symbols.find(s => s.name === 'party_name')!.location.uri).toBe(uri('/project/lib/text.ccs'));
    });
});

describe('Semantic tokens', () => {
    it('classifies identifiers by what they name', async () => {
        await startProject();
        const { data } = await client.request<SemanticTokens>('textDocument/semanticTokens/full', '/project/main.ccs');

        const lines = MAIN.split('\n');
        const tokens = new Map<string, string>();
        let line = 0;
        let character = 0;
        for (let i = 0; i < data.length; i += 5) {
            line += data[i];
            character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
            const text = lines[line].slice(character, character + data[i + 2]);
            const modifiers = semanticTokensLegend.tokenModifiers.filter((_, bit) => data[i + 4] & (1 << bit));
            tokens.set(`${text}@${line}`, [semanticTokensLegend.tokenTypes[data[i + 3]], ...modifiers].join('.'));
        }

        expect(tokens.get('party_name@5')).toBe('function');
        expect(tokens.get('next@6')).toBe('function.defaultLibrary');
        expect(tokens.get('MAX_LEVEL@2')).toBe('variable.readonly');
        expect(tokens.get('LV@2')).toBe('variable.declaration.readonly');
        expect(tokens.get('who@4')).toBe('parameter.declaration');
        expect(tokens.get('who@5')).toBe('parameter');
        expect(tokens.get('start@7')).toBe('label.declaration');
        expect(tokens.get('text@12')).toBe('namespace');
        expect(tokens.get('command@4')).toBe('keyword');
        expect(tokens.get('1@12')).toBe('number');
    });
});

describe('Structure', () => {
    it('folds blocks and label sections', async () => {
        await startProject();
        const ranges = await client.request<FoldingRange[]>('textDocument/foldingRange', '/project/main.ccs');
        const spans = ranges.map(r => [r.startLine, r.endLine]);
        expect(spans).toContainEqual([4, 8]); // greet's body (closing brace stays visible)
        expect(spans).toContainEqual([11, 13]); // intro's text
    });

    it('links import paths to their files', async () => {
        await startProject();
        const links = await client.request<DocumentLink[]>('textDocument/documentLink', '/project/main.ccs');
        expect(links).toHaveLength(1);
        expect(links[0].target).toBe(uri('/project/lib/text.ccs'));
        expect(textInRange(MAIN, links[0].range)).toBe('lib/text.ccs');
    });
});

describe('Quick fixes', () => {
    async function fixes(main: string, extraFiles: Record<string, string> = {}): Promise<CodeAction[]> {
        await startProject(main, extraFiles);
        const diagnostics = await client.waitForDiagnostics('/project/main.ccs');
        return client.request<CodeAction[]>('textDocument/codeAction', '/project/main.ccs', undefined, {
            range: diagnostics[0].range,
            context: { diagnostics },
        });
    }

    it('imports or qualifies a name declared in another module', async () => {
        const main = 'import "lib/text.ccs"\n\nintro: helper(1)\n';
        const actions = await fixes(main, { '/project/util.ccs': 'command helper(x) { }' });
        expect(actions.map(a => a.title)).toEqual(['Import "util.ccs"', "Change to 'util.helper'"]);
        expect(actions[0].isPreferred).toBe(true);

        // Applying the import fixes the error
        const edit = actions[0].edit!.changes![uri('/project/main.ccs')][0];
        expect(edit.newText).toBe('\nimport "util.ccs"');
        await client.edit('/project/main.ccs', edit.range, edit.newText);
        expect(await client.waitForDiagnostics('/project/main.ccs')).toEqual([]);
    });

    it('suggests similar names for typos', async () => {
        const actions = await fixes('intro: nxet\n');
        expect(actions.map(a => a.title)).toEqual(["Change to 'next'"]);
    });

    it('suggests similar members', async () => {
        const main = 'import "lib/text.ccs"\nintro: text.gve(1, 2)\n';
        const actions = await fixes(main);
        expect(actions.map(a => a.title)).toEqual(["Change to 'text.give'"]);
        expect(textInRange(main, actions[0].edit!.changes![uri('/project/main.ccs')][0].range)).toBe('gve');
    });
});
