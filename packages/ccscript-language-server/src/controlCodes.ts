/**
 * Decoding raw control codes in strings (e.g. "[1C 05 12]") back into the commands that
 * produce them (`itemname(18)`), using the bodies of loaded commands such as
 * `command itemname(item) "[1C 05 {byte item}]"` as patterns.
 */

import { Module, Symbol, SymbolKind, SyntaxKind, SyntaxTree, isRedToken } from 'ccscript-core';
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

/**
 * Split a run of bytes into control codes. At each point the most specific matching
 * command wins (the most fixed bytes); unknown bytes become one-byte codes.
 */
export function decodeControlCodes(bytes: number[], patterns: ControlCodePattern[]): DecodedCode[] {
    const matchesAt = (index: number) => patterns
        .map(pattern => ({ pattern, arguments: match(pattern, bytes, index) }))
        .filter((m): m is { pattern: ControlCodePattern; arguments: Map<string, number> } => !!m.arguments)
        .sort((a, b) => b.pattern.fixedBytes - a.pattern.fixedBytes);

    const codes: DecodedCode[] = [];
    let index = 0;
    while (index < bytes.length) {
        const matches = matchesAt(index);
        const best = matches[0];
        if (!best) {
            // An unknown code: up to where a known one starts (codes 18-1F take a sub-code byte)
            let end = index + (bytes[index] >= 0x18 && bytes[index] <= 0x1F ? 2 : 1);
            while (end < bytes.length && matchesAt(end).length === 0) end++;
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

/**
 * The bytes of the bracketed control code group around an offset in source text, with each
 * byte's offset. Returns undefined if the offset isn't inside a group of plain hex bytes.
 */
export function controlCodeGroupAt(source: string, offset: number): { bytes: number[]; offsets: number[] } | undefined {
    const open = source.lastIndexOf('[', offset);
    if (open < 0 || /[\]"\n]/.test(source.slice(open + 1, offset))) {
        return undefined;
    }
    const close = source.indexOf(']', open);
    if (close < 0 || close < offset || /["\n]/.test(source.slice(open, close))) {
        return undefined;
    }

    const bytes: number[] = [];
    const offsets: number[] = [];
    for (const part of source.slice(open + 1, close).matchAll(/\S+/g)) {
        if (!/^[0-9A-Fa-f]{2}$/.test(part[0])) {
            return undefined; // e.g. a {template} inside the code
        }
        bytes.push(parseInt(part[0], 16));
        offsets.push(open + 1 + part.index!);
    }
    return bytes.length > 0 ? { bytes, offsets } : undefined;
}
