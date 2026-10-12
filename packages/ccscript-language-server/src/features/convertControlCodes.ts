/**
 * Rewriting raw control codes in strings as the commands that produce them:
 * "[1F 11 03][1F 61]" -> "{party_add(3)}{wait_for_movement}". Only codes a command's body
 * matches exactly are converted, so the result compiles to the same bytes.
 */

import { CodeAction, CodeActionKind, Range, TextEdit } from 'vscode-languageserver/node';
import { Module, Symbol, SymbolKind } from 'ccscript-core';
import {
    ControlCodeDecoder,
    Match,
    StringControlCodeGroup,
    controlCodeDecoder,
    controlCodeGroupsInStrings,
    formatCall,
    formatNumber,
    patternOf,
} from '../controlCodes';
import { importEdit } from '../imports';
import { Analysis, Workspace } from '../workspace';

/** Source action kind for converting a whole file */
export const CONVERT_FILE_KIND = `${CodeActionKind.Source}.convertControlCodes`;

const hex = (bytes: number[]) => bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

type Segment = { kind: 'raw'; bytes: number[] } | { kind: 'call'; match: Match };

/**
 * Whether the file sees a command under its own name.
 */
function isVisible(analysis: Analysis, command: Symbol): boolean {
    const globalScope = analysis.binding.scopes.getGlobalScope().id;
    return analysis.binding.symbols.lookup(command.name, [globalScope], SymbolKind.Command)?.id === command.id;
}

function moduleOf(workspace: Workspace, command: Symbol): Module | undefined {
    const module = command.modulePath ? workspace.program.getModule(command.modulePath) : undefined;
    // Qualified names need the module to be the one known by that name
    return module && workspace.program.getModuleByName(module.name) === module ? module : undefined;
}

/**
 * Split a group into raw bytes and calls, picking for each code the command the file sees
 * by name if there is one, else the decoder's first (the standard library's first).
 */
function planGroup(workspace: Workspace, analysis: Analysis, decoder: ControlCodeDecoder, group: StringControlCodeGroup): Segment[] | undefined {
    // Leave command definitions alone (command next "[03]" must stay bytes)
    if (group.command) {
        const symbol = analysis.binding.symbols.getSymbolAt(
            group.command.getIdentifierToken()?.span.start ?? -1, analysis.filePath);
        if (!symbol || patternOf(symbol, analysis.tree.source)) {
            return undefined;
        }
    }

    const segments: Segment[] = [];
    for (const code of decoder.decode(group.bytes)) {
        const usable = code.matches.filter(m => isVisible(analysis, m.pattern.command) || moduleOf(workspace, m.pattern.command));
        const match = usable.find(m => isVisible(analysis, m.pattern.command)) ?? usable[0];
        if (match) {
            segments.push({ kind: 'call', match });
            continue;
        }
        const bytes = group.bytes.slice(code.start, code.start + code.length);
        const last = segments[segments.length - 1];
        if (last?.kind === 'raw') last.bytes.push(...bytes); else segments.push({ kind: 'raw', bytes });
    }
    return segments.some(s => s.kind === 'call') ? segments : undefined;
}

/**
 * Whether importing a module would leave everything else meaning the same: none of the
 * commands we'd call by name are shadowed by another declaration, and none of the names the
 * file already uses from other imports would become ambiguous.
 */
function canImport(workspace: Workspace, analysis: Analysis, module: Module, commands: Symbol[]): boolean {
    if (module.filePath === analysis.filePath) {
        return false;
    }
    const globalScope = analysis.binding.scopes.getGlobalScope().id;
    for (const command of commands) {
        const existing = analysis.binding.symbols.lookup(command.name, [globalScope]);
        if (existing && existing.id !== command.id) return false;
    }
    const names = new Set(workspace.program.getModuleDeclarations(module).getAllSymbols()
        .filter(s => s.scopeId === 0).map(s => s.name));
    for (const referenced of analysis.binding.references.values()) {
        if (referenced.scopeId === 0 && referenced.modulePath !== analysis.filePath &&
            referenced.modulePath !== module.filePath && names.has(referenced.name)) {
            return false;
        }
    }
    return true;
}

/**
 * Edits converting groups: their replacements, plus imports of modules whose commands can
 * then be called by name (others are called qualified, e.g. {module.command}).
 */
function edits(workspace: Workspace, analysis: Analysis, groups: StringControlCodeGroup[], skipData = false): TextEdit[] {
    const decoder = controlCodeDecoder(workspace);
    const { document } = analysis;
    const skipped = skipData ? dataGroups(decoder, groups) : new Set<StringControlCodeGroup>();

    const plans: { group: StringControlCodeGroup; segments: Segment[] }[] = [];
    for (const group of groups) {
        const segments = skipped.has(group) ? undefined : planGroup(workspace, analysis, decoder, group);
        if (segments) plans.push({ group, segments });
    }

    // Modules to import: those providing commands the file doesn't see yet, if that's safe
    const needed = new Map<Module, Symbol[]>();
    for (const { segments } of plans) {
        for (const segment of segments) {
            if (segment.kind !== 'call' || isVisible(analysis, segment.match.pattern.command)) continue;
            const module = moduleOf(workspace, segment.match.pattern.command)!;
            const commands = needed.get(module) ?? [];
            if (!commands.includes(segment.match.pattern.command)) commands.push(segment.match.pattern.command);
            needed.set(module, commands);
        }
    }
    const imported = new Set([...needed].filter(([module, commands]) => canImport(workspace, analysis, module, commands)).map(([m]) => m));

    const result: TextEdit[] = [];
    for (const { group, segments } of plans) {
        const text = segments.map(segment => {
            if (segment.kind === 'raw') return `[${hex(segment.bytes)}]`;
            const command = segment.match.pattern.command;
            const module = moduleOf(workspace, command);
            const name = isVisible(analysis, command) || (module && imported.has(module)) ? command.name : `${module!.name}.${command.name}`;
            return `{${name}${formatCall(segment.match, (_, value) => formatNumber(value)).slice(command.name.length)}}`;
        }).join('');
        result.push(TextEdit.replace(Range.create(document.positionAt(group.open), document.positionAt(group.close + 1)), text));
    }
    if (imported.size > 0) {
        result.push(importEdit(workspace, analysis, [...imported]));
    }
    return result;
}

/**
 * Whether a group in a string of only bytes looks like binary data (e.g. "[00 00 00 00 ...]"
 * in a table) rather than text: it has bytes no command produces, is one code repeated, or
 * repeats a code four or more times.
 */
function groupLooksLikeData(decoder: ControlCodeDecoder, group: StringControlCodeGroup): boolean {
    const codes = decoder.decode(group.bytes);
    if (codes.some(c => c.matches.length === 0)) {
        return true;
    }
    const codeBytes = codes.map(c => hex(group.bytes.slice(c.start, c.start + c.length)));
    if (codes.length > 1 && codeBytes.every(b => b === codeBytes[0])) {
        return true;
    }
    let run = 1;
    for (let i = 1; i < codes.length; i++) {
        const same = hex(group.bytes.slice(codes[i].start, codes[i].start + codes[i].length)) ===
            hex(group.bytes.slice(codes[i - 1].start, codes[i - 1].start + codes[i - 1].length));
        run = same ? run + 1 : 1;
        if (run >= 4) return true;
    }
    return false;
}

/**
 * Groups to leave alone when converting a whole file, because they're probably data rather
 * than text: strings passed as arguments or written to the ROM, a [00] ending a string (a
 * terminator), and strings of only bytes where any group looks like data.
 */
function dataGroups(decoder: ControlCodeDecoder, groups: StringControlCodeGroup[]): Set<StringControlCodeGroup> {
    const data = new Set<StringControlCodeGroup>();
    const dataStrings = new Set<number>();
    for (const group of groups) {
        if (group.onlyBytes && groupLooksLikeData(decoder, group)) {
            dataStrings.add(group.stringStart);
        }
    }
    for (const group of groups) {
        const terminator = group.endsString && group.bytes.length === 1 && group.bytes[0] === 0;
        if (group.isArgument || group.isRomWrite || terminator || dataStrings.has(group.stringStart)) {
            data.add(group);
        }
    }
    return data;
}

/**
 * Actions for converting control codes: the groups in the selection (or under the cursor),
 * and, for the source action menu, the whole file (computed when chosen; see resolve), which
 * skips strings that look like binary data.
 */
export function provideConvertActions(workspace: Workspace, analysis: Analysis, range: Range, only?: string[]): CodeAction[] {
    const actions: CodeAction[] = [];
    const wants = (kind: string) => !only || only.some(o => kind === o || kind.startsWith(`${o}.`));

    if (wants(CodeActionKind.RefactorRewrite)) {
        const start = analysis.document.offsetAt(range.start);
        const end = analysis.document.offsetAt(range.end);
        const selected = controlCodeGroupsInStrings(analysis.tree, start, end)
            .filter(g => g.open <= end && g.close + 1 >= start);
        const groupEdits = edits(workspace, analysis, selected);
        const groupCount = groupEdits.filter(e => e.newText.includes('{')).length;
        if (groupCount > 0) {
            actions.push({
                title: groupCount === 1 ? 'Convert to commands' : `Convert ${groupCount} control code groups to commands`,
                kind: CodeActionKind.RefactorRewrite,
                edit: { changes: { [analysis.uri]: groupEdits } },
            });
        }
    }

    if (wants(CONVERT_FILE_KIND) && analysis.tree.source.includes('[')) {
        actions.push({
            title: 'Convert all control codes in this file to commands',
            kind: CONVERT_FILE_KIND,
            data: { uri: analysis.uri, version: analysis.document.version },
        });
    }
    return actions;
}

/**
 * Compute the whole-file conversion for a chosen source action.
 */
export function resolveConvertFileAction(workspace: Workspace, analysis: Analysis, action: CodeAction): CodeAction {
    const fileEdits = edits(workspace, analysis, controlCodeGroupsInStrings(analysis.tree), true);
    return { ...action, edit: { changes: { [analysis.uri]: fileEdits } } };
}
