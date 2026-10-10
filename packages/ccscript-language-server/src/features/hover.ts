import { Hover, HoverParams, MarkupKind } from 'vscode-languageserver/node';
import { RedNode, Symbol, SymbolKind, isRedToken } from 'ccscript-core';
import {
    constantsByValue,
    entryForArgument,
    formatHex,
    numericLiteralAt,
    numericValue,
} from '../gameData';
import { DOMAIN_TITLES, ProjectData, tableTitle } from '../projectData';
import { describeSymbol, findTarget, getDocComment, symbolKindName } from '../symbols';
import { Analysis, Workspace, pathToUri } from '../workspace';

function fileLink(file: string, line: number, text: string): string {
    return `[${text}](${pathToUri(file)}#L${line + 1})`;
}

/**
 * Where an address points, for SNES addresses in EarthBound's (HiROM) layout.
 */
function addressNote(value: number): string | undefined {
    if (value >= 0xC00000 && value <= 0xFFFFFF) {
        return `ROM address · file offset \`${formatHex(value - 0xC00000)}\` (unheadered)`;
    }
    if (value >= 0x7E0000 && value <= 0x7FFFFF) {
        return 'RAM address';
    }
    return undefined;
}

function numberLines(value: number): string[] {
    const lines = [`**${value}** · \`${formatHex(value)}\``];
    const note = addressNote(value);
    if (note) lines.push(note);
    return lines;
}

async function hoverNumber(workspace: Workspace, project: ProjectData | undefined, analysis: Analysis, literal: RedNode): Promise<string | undefined> {
    const value = numericValue(literal);
    if (value === undefined) return undefined;
    const parts = numberLines(value);

    const found = await entryForArgument(workspace, project, analysis, literal);
    if (found?.entry) {
        const title = `${DOMAIN_TITLES[found.domain]} ${value}`;
        parts.push(`${found.entry.name ? `${title}: **${found.entry.name}**` : title} · ` +
            fileLink(found.entry.file, found.entry.line, found.entry.file.replace(/^.*[\\/]/, '')));
    }

    const constants = (constantsByValue(workspace).get(value) ?? []).filter(s => s.position !== literal.span.start);
    if (constants.length > 0 && value >= 0x100) {
        const names = constants.slice(0, 5).map(s => `\`${s.name}\``).join(', ');
        parts.push(`Same value as ${names}${constants.length > 5 ? ` and ${constants.length - 5} more` : ''}`);
    }
    return parts.join('\n\n');
}

async function labelLines(workspace: Workspace, project: ProjectData | undefined, symbol: Symbol): Promise<string[]> {
    const module = symbol.modulePath ? workspace.program.getModule(symbol.modulePath) : undefined;
    if (!project || !module || symbol.scopeId !== 0) return [];
    const key = `${module.name}.${symbol.name}`;
    const lines: string[] = [];

    const address = (await project.labelAddresses()).get(key);
    if (address !== undefined) {
        lines.push(`Compiled to \`$${address.toString(16).toUpperCase()}\` (last build)`);
    }

    const uses = (await project.tableReferences()).get(key) ?? [];
    if (uses.length > 0) {
        const shown = uses.slice(0, 8).map(u =>
            `- ${fileLink(u.file, u.line, `${tableTitle(u.file)}${u.id !== undefined ? ` ${u.id}` : ''}`)} · ${u.field}`);
        if (uses.length > 8) shown.push(`- …and ${uses.length - 8} more`);
        lines.push(`Used by:\n${shown.join('\n')}`);
    }
    return lines;
}

export async function provideHover(workspace: Workspace, analysis: Analysis, params: HoverParams): Promise<Hover | null> {
    const offset = analysis.document.offsetAt(params.position);
    const project = await workspace.projectFor(analysis.filePath);
    const rangeOf = (node: RedNode) => ({
        start: analysis.document.positionAt(node.span.start),
        end: analysis.document.positionAt(node.span.start + node.span.length),
    });

    const literal = numericLiteralAt(analysis, offset);
    if (literal) {
        const value = await hoverNumber(workspace, project, analysis, literal);
        return value ? { contents: { kind: MarkupKind.Markdown, value }, range: rangeOf(literal) } : null;
    }

    const target = findTarget(workspace, analysis, offset);
    if (!target) {
        return null;
    }

    const fs = workspace.fileSystem;
    const relative = (filePath: string) =>
        fs.relative(fs.dirname(analysis.filePath), filePath).replace(/\\/g, '/');
    const range = rangeOf(target.token);

    if (target.kind === 'module') {
        const value = target.module
            ? `\`\`\`ccscript\nimport ${target.module.name}\n\`\`\`\n*${relative(target.module.filePath)}*`
            : `Module \`${target.name}\` isn't loaded`;
        return { contents: { kind: MarkupKind.Markdown, value }, range };
    }

    const { symbol } = target;
    const declaringModule = symbol.modulePath ? workspace.program.getModule(symbol.modulePath) : undefined;
    const source = declaringModule?.tree.source;

    const parts = [`\`\`\`ccscript\n${describeSymbol(symbol, source)}\n\`\`\``];
    const docs = getDocComment(symbol, source);
    if (docs) {
        parts.push(docs);
    }

    if (symbol.kind === SymbolKind.Constant) {
        const valueNode = symbol.declaration.getChildren().filter(c => !isRedToken(c)).pop();
        const value = valueNode && numericValue(valueNode);
        if (value !== undefined) parts.push(numberLines(value).join(' · '));
    }
    if (symbol.kind === SymbolKind.Label) {
        parts.push(...await labelLines(workspace, project, symbol));
    }

    if (declaringModule && declaringModule.filePath !== analysis.filePath) {
        const where = workspace.isStandardLibrary(declaringModule.filePath) ? 'standard library' : relative(declaringModule.filePath);
        parts.push(`*${symbolKindName(symbol.kind)} from ${where}*`);
    }

    return { contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') }, range };
}
