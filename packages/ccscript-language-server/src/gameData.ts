/**
 * Connects syntax to project reference data: what a literal argument means, which constants
 * share a value, and what text a label holds.
 */

import { Module, RedNode, Symbol, SymbolKind, SyntaxKind, SyntaxTree, isRedToken } from 'ccscript-core';
import { Domain, domainOfParameter, Entry, LabelTextResolver, ProjectData } from './projectData';
import { getParameterNames } from './symbols';
import { Analysis, Workspace } from './workspace';

/**
 * The value of a numeric literal expression or token (decimal or 0x hex).
 */
export function numericValue(node: RedNode): number | undefined {
    const token = isRedToken(node) ? node : node.kind === SyntaxKind.NumericLiteralExpression ? node.getChildren()[0] : undefined;
    if (!token || !isRedToken(token)) return undefined;
    if (token.kind === SyntaxKind.HexLiteral) return parseInt(token.text.slice(2), 16);
    if (token.kind === SyntaxKind.NumericLiteral && /^\d+$/.test(token.text)) return parseInt(token.text, 10);
    return undefined;
}

export function formatHex(value: number): string {
    return `0x${value.toString(16).toUpperCase()}`;
}

/**
 * For an expression passed to a command, the command, parameter and the kind of game data
 * the parameter refers to.
 */
export function argumentInfo(analysis: Analysis, expression: RedNode): { command: Symbol; parameter: string; domain?: Domain } | undefined {
    const argumentList = expression.parent;
    const call = argumentList?.parent;
    if (argumentList?.kind !== SyntaxKind.ArgumentList || call?.kind !== SyntaxKind.CallExpression) {
        return undefined;
    }
    const command = analysis.binding.references.get(call.getChildren()[0]);
    if (!command || command.kind !== SymbolKind.Command) {
        return undefined;
    }
    const index = argumentList.getChildren().filter(c => !isRedToken(c)).indexOf(expression);
    const parameter = getParameterNames(command)[index];
    return parameter === undefined ? undefined : { command, parameter, domain: domainOfParameter(parameter) };
}

/**
 * The numeric literal containing an offset, if any.
 */
export function numericLiteralAt(analysis: Analysis, offset: number): RedNode | undefined {
    for (const position of [offset, offset - 1]) {
        if (position < 0) continue;
        const token = analysis.tree.getTokenAtPosition(position);
        const expression = token?.parent;
        if (expression?.kind === SyntaxKind.NumericLiteralExpression &&
            token!.span.start <= offset && offset <= token!.span.start + token!.span.length) {
            return expression;
        }
    }
    return undefined;
}

// ========== Constants by value ==========

const constantsByTree = new WeakMap<SyntaxTree, { symbol: Symbol; value: number }[]>();

/**
 * Constants defined directly as a number, e.g. `define Smash = 0xC2AB79`.
 */
function numericConstants(workspace: Workspace, module: Module): { symbol: Symbol; value: number }[] {
    let constants = constantsByTree.get(module.tree);
    if (!constants) {
        constants = [];
        for (const symbol of workspace.program.getModuleDeclarations(module).getAllSymbols()) {
            if (symbol.kind !== SymbolKind.Constant) continue;
            const valueNode = symbol.declaration.getChildren().filter(c => !isRedToken(c)).pop();
            const value = valueNode && numericValue(valueNode);
            if (value !== undefined) constants.push({ symbol, value });
        }
        constantsByTree.set(module.tree, constants);
    }
    return constants;
}

/**
 * Constants (in all loaded modules) by their numeric value.
 */
export function constantsByValue(workspace: Workspace): Map<number, Symbol[]> {
    const index = new Map<number, Symbol[]>();
    for (const module of workspace.program.getAllModules()) {
        for (const { symbol, value } of numericConstants(workspace, module)) {
            const list = index.get(value);
            if (list) list.push(symbol); else index.set(value, [symbol]);
        }
    }
    return index;
}

/** Literals at least this large are treated as addresses worth naming */
export const ADDRESS_THRESHOLD = 0x10000;

// ========== Labels ==========

/**
 * A short preview of the text at a `module.label`: its first string, without control codes.
 */
export function labelText(workspace: Workspace, qualifiedLabel: string): string | undefined {
    const [moduleName, labelName] = qualifiedLabel.split('.');
    const module = workspace.program.getModuleByName(moduleName);
    const label = module && workspace.program.getModuleDeclarations(module).getAll(labelName)
        .find(s => s.kind === SymbolKind.Label);
    if (!module || !label) return undefined;

    const source = module.tree.source;
    const start = source.indexOf('"', label.position);
    // Only the label's own text: stop at the next label
    const nextLabel = source.slice(label.position + label.length).search(/\n\s*[A-Za-z_]\w*:/);
    if (start < 0 || (nextLabel >= 0 && start > label.position + label.length + nextLabel)) return undefined;
    const end = source.indexOf('"', start + 1);
    if (end < 0) return undefined;

    const text = source.slice(start + 1, end)
        .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
        .replace(/[@|/]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return undefined;
    return text.length > 40 ? `“${text.slice(0, 39)}…”` : `“${text}”`;
}

export function labelTextResolver(workspace: Workspace): LabelTextResolver {
    return qualifiedLabel => labelText(workspace, qualifiedLabel);
}

/**
 * Look up what a literal argument refers to in the project's tables.
 */
export async function entryForArgument(
    workspace: Workspace,
    project: ProjectData | undefined,
    analysis: Analysis,
    literal: RedNode
): Promise<{ domain: Domain; entry: Entry | undefined; value: number } | undefined> {
    const info = argumentInfo(analysis, literal);
    const value = numericValue(literal);
    if (!info?.domain || value === undefined) return undefined;
    const entry = project ? await project.entry(info.domain, value, labelTextResolver(workspace)) : undefined;
    return { domain: info.domain, entry, value };
}
