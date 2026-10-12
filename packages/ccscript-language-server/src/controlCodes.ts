/**
 * Decoding raw control codes in strings (e.g. "[1C 05 12]") back into the commands that
 * produce them (`itemname(18)`), using the bodies of loaded commands such as
 * `command itemname(item) "[1C 05 {byte item}]"` as patterns.
 */

import { Module, RedNode, Symbol, SymbolKind, SyntaxKind, SyntaxTree, isRedToken } from 'ccscript-core';
import { getParameterNames } from './symbols';
import { Workspace } from './workspace';

type PatternElement =
    | { kind: 'byte'; value: number }
    /** A parameter's bytes (little-endian), or one byte of it (`{byte[1] n}`) */
    | { kind: 'parameter'; name: string; size: number; byteIndex?: number };

export interface ControlCodePattern {
    command: Symbol;
    elements: PatternElement[];
    /** Number of fixed bytes, for preferring the most specific match */
    fixedBytes: number;
}

const SIZES: Record<string, number> = { byte: 1, short: 2, long: 4 };

/**
 * The pattern for a command whose body is only control codes, like "[1C 05 {byte item}]".
 */
export function patternOf(command: Symbol, source: string): ControlCodePattern | undefined {
    let body = command.declaration.getChildren().filter(c => !isRedToken(c) && c.kind !== SyntaxKind.ParameterList).pop();
    if (body?.kind === SyntaxKind.ExpressionStatement) {
        body = body.getChildren().find(c => !isRedToken(c));
    }
    if (!body || (body.kind !== SyntaxKind.StringLiteralExpression && body.kind !== SyntaxKind.TemplateStringExpression)) {
        return undefined;
    }
    const text = source.slice(body.span.start, body.span.start + body.span.length);
    // Brackets of bytes and placeholders (which can contain ']' themselves, as in {byte[1] n})
    const group = /\[((?:\{[^}]*\}|[^\]{])*)\]/g;
    const content = text.match(/^"((?:\s*\[(?:\{[^}]*\}|[^\]{])*\])+)\s*"$/);
    if (!content) {
        return undefined;
    }

    const parameters = new Set(getParameterNames(command));
    const elements: PatternElement[] = [];
    for (const bracket of content[1].matchAll(group)) {
        for (const part of bracket[1].match(/\{[^}]*\}|\S+/g) ?? []) {
            if (/^[0-9A-Fa-f]{2}$/.test(part)) {
                elements.push({ kind: 'byte', value: parseInt(part, 16) });
                continue;
            }
            // {byte x}, {short x}, {long x}, {byte[1] x}, or the call form {short(x)}
            const slot = part.match(/^\{\s*(byte|short|long)\s*(?:\[\s*(\d)\s*\])?\s*(?:\(\s*([A-Za-z_]\w*)\s*\)|\s([A-Za-z_]\w*))\s*\}$/);
            const name = slot && (slot[3] ?? slot[4]);
            if (!slot || !name || !parameters.has(name)) {
                return undefined; // Something we can't match against raw bytes
            }
            elements.push(slot[2] !== undefined
                ? { kind: 'parameter', name, size: 1, byteIndex: parseInt(slot[2], 10) }
                : { kind: 'parameter', name, size: SIZES[slot[1]] });
        }
    }

    const fixedBytes = elements.filter(e => e.kind === 'byte').length;
    return elements[0]?.kind === 'byte' ? { command, elements, fixedBytes } : undefined;
}

const patternsByTree = new WeakMap<SyntaxTree, ControlCodePattern[]>();

/**
 * Patterns for every control-code command in the loaded modules, standard library first.
 */
export function controlCodePatterns(workspace: Workspace): ControlCodePattern[] {
    const forModule = (module: Module) => {
        let patterns = patternsByTree.get(module.tree);
        if (!patterns) {
            patterns = workspace.program.getModuleDeclarations(module).getAllSymbols()
                .filter(s => s.kind === SymbolKind.Command && s.scopeId === 0)
                .map(s => patternOf(s, module.tree.source))
                .filter((p): p is ControlCodePattern => !!p);
            // Text control codes are 00-1F. A module with byte commands from 20 up is machine
            // code macros (like a 65816 assembler's opcodes, which also use 00-1F), not text.
            if (patterns.some(p => (p.elements[0] as { value: number }).value >= 0x20)) {
                patterns = [];
            }
            patternsByTree.set(module.tree, patterns);
        }
        return patterns;
    };

    const modules = workspace.program.getAllModules();
    const std = modules.filter(m => workspace.isStandardLibrary(m.filePath));
    const rest = modules.filter(m => !workspace.isStandardLibrary(m.filePath));
    return [...std, ...rest].flatMap(forModule);
}

export interface DecodedCode {
    /** Index of the code's first byte, and how many bytes it spans */
    start: number;
    length: number;
    /** Matching commands, best first; empty if unknown */
    matches: { pattern: ControlCodePattern; arguments: Map<string, number> }[];
}

function match(pattern: ControlCodePattern, bytes: number[], start: number): Map<string, number> | undefined {
    const values = new Map<string, number>();
    let index = start;
    for (const element of pattern.elements) {
        if (element.kind === 'byte') {
            if (bytes[index] !== element.value) return undefined;
            index++;
            continue;
        }
        if (index + element.size > bytes.length) return undefined;
        let value = 0;
        for (let i = 0; i < element.size; i++) {
            value |= bytes[index + i] << (8 * i);
        }
        if (element.byteIndex !== undefined) {
            value = (values.get(element.name) ?? 0) | (value << (8 * element.byteIndex));
        }
        values.set(element.name, value >>> 0);
        index += element.size;
    }
    return values;
}

function lengthOf(pattern: ControlCodePattern): number {
    return pattern.elements.reduce((sum, e) => sum + (e.kind === 'byte' ? 1 : e.size), 0);
}

export type Match = { pattern: ControlCodePattern; arguments: Map<string, number> };

/**
 * A decoded code as a call, e.g. `itemname(18)`, formatting each argument with `format`.
 */
export function formatCall(match: Match, format: (parameter: string, value: number) => string): string {
    const parameters = getParameterNames(match.pattern.command);
    return parameters.length > 0
        ? `${match.pattern.command.name}(${parameters.map(p => format(p, match.arguments.get(p) ?? 0)).join(', ')})`
        : match.pattern.command.name;
}

export function formatNumber(value: number): string {
    return value >= 0x10000 ? `0x${value.toString(16).toUpperCase()}` : String(value);
}

/**
 * Splits runs of bytes into control codes. At each point the most specific matching command
 * wins (the most fixed bytes); unknown bytes are grouped until a known code starts.
 */
export class ControlCodeDecoder {
    /** Patterns by their first byte (every pattern starts with a fixed byte) */
    private readonly byFirstByte = new Map<number, ControlCodePattern[]>();

    constructor(patterns: ControlCodePattern[]) {
        for (const pattern of patterns) {
            const first = (pattern.elements[0] as { value: number }).value;
            const list = this.byFirstByte.get(first);
            if (list) list.push(pattern); else this.byFirstByte.set(first, [pattern]);
        }
    }

    private matchesAt(bytes: number[], index: number): Match[] {
        return (this.byFirstByte.get(bytes[index]) ?? [])
            .map(pattern => ({ pattern, arguments: match(pattern, bytes, index) }))
            .filter((m): m is Match => !!m.arguments)
            .sort((a, b) => b.pattern.fixedBytes - a.pattern.fixedBytes);
    }

    decode(bytes: number[]): DecodedCode[] {
        const codes: DecodedCode[] = [];
        let index = 0;
        while (index < bytes.length) {
            const matches = this.matchesAt(bytes, index);
            const best = matches[0];
            if (!best) {
                // An unknown code: up to where a known one starts (codes 18-1F take a sub-code byte)
                let end = index + (bytes[index] >= 0x18 && bytes[index] <= 0x1F ? 2 : 1);
                while (end < bytes.length && this.matchesAt(bytes, end).length === 0) end++;
                end = Math.min(end, bytes.length);
                codes.push({ start: index, length: end - index, matches: [] });
                index = end;
                continue;
            }

            // Only alternatives as specific (and as long) as the best
            const length = lengthOf(best.pattern);
            const alternatives = matches.filter(m => m.pattern.fixedBytes === best.pattern.fixedBytes && lengthOf(m.pattern) === length);
            codes.push({ start: index, length, matches: alternatives });
            index += length;
        }
        return codes;
    }
}

/**
 * A decoder for the control-code commands in the loaded modules.
 */
export function controlCodeDecoder(workspace: Workspace): ControlCodeDecoder {
    return new ControlCodeDecoder(controlCodePatterns(workspace));
}

export interface ControlCodeGroup {
    /** Offsets of the brackets */
    open: number;
    close: number;
    bytes: number[];
    /** Offset of each byte */
    offsets: number[];
}

function readGroup(source: string, open: number, close: number): ControlCodeGroup | undefined {
    const bytes: number[] = [];
    const offsets: number[] = [];
    for (const part of source.slice(open + 1, close).matchAll(/\S+/g)) {
        if (!/^[0-9A-Fa-f]{2}$/.test(part[0])) {
            return undefined; // e.g. a {template} inside the code
        }
        bytes.push(parseInt(part[0], 16));
        offsets.push(open + 1 + part.index!);
    }
    return bytes.length > 0 ? { open, close, bytes, offsets } : undefined;
}

/**
 * Bracketed groups of plain hex bytes in a piece of string text.
 */
export function controlCodeGroupsIn(source: string, start: number, end: number): ControlCodeGroup[] {
    const groups: ControlCodeGroup[] = [];
    for (const found of source.slice(start, end).matchAll(/\[[0-9A-Fa-f\s]*\]/g)) {
        const open = start + found.index!;
        const group = readGroup(source, open, open + found[0].length - 1);
        if (group) groups.push(group);
    }
    return groups;
}

export interface StringControlCodeGroup extends ControlCodeGroup {
    /** The command declaration the string is in, if any */
    command?: RedNode;
    /** Where the string containing the group starts */
    stringStart: number;
    /** Whether the string is nothing but bracketed bytes (no text or {expressions}) */
    onlyBytes: boolean;
    /** Whether the string is a command argument, or written to the ROM (so it's data) */
    isArgument: boolean;
    isRomWrite: boolean;
    /** Whether the group is the last thing in its string */
    endsString: boolean;
}

/**
 * Bracketed groups of raw control codes in the string text of a tree, optionally only those
 * in strings overlapping [start, end].
 */
export function controlCodeGroupsInStrings(tree: SyntaxTree, start = 0, end = tree.source.length): StringControlCodeGroup[] {
    const groups: StringControlCodeGroup[] = [];
    for (const token of tree.getTokens()) {
        const tokenEnd = token.span.start + token.span.length;
        if (token.kind !== SyntaxKind.StringLiteral || !token.text.includes('[') ||
            tokenEnd < start || token.span.start > end ||
            token.parent?.kind === SyntaxKind.ImportStatement) {
            continue;
        }
        const command = token.getAncestorOfKind(SyntaxKind.CommandDeclaration) ?? undefined;
        // (A string's text can be split into several tokens around {expressions})
        const string = token.getAncestorOfKind(SyntaxKind.StringLiteralExpression) ??
            token.getAncestorOfKind(SyntaxKind.TemplateStringExpression) ?? token;
        const stringText = tree.source.slice(string.span.start, string.span.start + string.span.length);
        const onlyBytes = /^"?(\s*\[[0-9A-Fa-f\s]*\])*\s*"?$/.test(stringText);
        const isArgument = string.parent?.kind === SyntaxKind.ArgumentList;
        const isRomWrite = !!(token.getAncestorOfKind(SyntaxKind.ROMWriteStatement) ??
            token.getAncestorOfKind(SyntaxKind.ROMTableWriteStatement));
        for (const group of controlCodeGroupsIn(tree.source, token.span.start, tokenEnd)) {
            const endsString = /^\s*"/.test(tree.source.slice(group.close + 1, group.close + 20));
            groups.push({ ...group, command, stringStart: string.span.start, onlyBytes, isArgument, isRomWrite, endsString });
        }
    }
    return groups;
}

/**
 * The bytes of the bracketed control code group around an offset in source text, with each
 * byte's offset. Returns undefined if the offset isn't inside a group of plain hex bytes.
 */
export function controlCodeGroupAt(source: string, offset: number): ControlCodeGroup | undefined {
    const open = source.lastIndexOf('[', offset);
    if (open < 0 || /[\]"\n]/.test(source.slice(open + 1, offset))) {
        return undefined;
    }
    const close = source.indexOf(']', open);
    if (close < 0 || close < offset || /["\n]/.test(source.slice(open, close))) {
        return undefined;
    }
    return readGroup(source, open, close);
}
