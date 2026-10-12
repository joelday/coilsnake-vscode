import { InlayHint, InlayHintKind, InlayHintParams, MarkupKind } from 'vscode-languageserver/node';
import { RedNode, SymbolKind, SyntaxKind, isRedToken } from 'ccscript-core';
import {
    ADDRESS_THRESHOLD,
    argumentInfo,
    constantsByValue,
    entryForArgument,
    numericValue,
} from '../gameData';
import { controlCodeDecoder, controlCodeGroupsInStrings, formatCall, formatNumber } from '../controlCodes';
import { DOMAIN_TITLES, domainOfParameter, domainOfTable, tableTitle } from '../projectData';
import { labelTextResolver } from '../gameData';
import { Analysis, Workspace, pathToUri } from '../workspace';

const LITERALS = new Set([SyntaxKind.NumericLiteralExpression, SyntaxKind.StringLiteralExpression, SyntaxKind.TemplateStringExpression]);

function collect(node: RedNode, kinds: Set<SyntaxKind>, into: RedNode[]): RedNode[] {
    if (kinds.has(node.kind)) into.push(node);
    for (const child of node.getChildren()) {
        if (!isRedToken(child)) collect(child, kinds, into);
    }
    return into;
}

function truncate(text: string, length = 42): string {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export async function provideInlayHints(workspace: Workspace, analysis: Analysis, params: InlayHintParams): Promise<InlayHint[]> {
    const { document, tree, module } = analysis;
    const start = document.offsetAt(params.range.start);
    const end = document.offsetAt(params.range.end);
    const inRange = (node: RedNode) => node.span.start + node.span.length >= start && node.span.start <= end;
    const project = await workspace.projectFor(analysis.filePath);
    const hints: InlayHint[] = [];

    // Arguments: parameter names, and what literal values refer to
    const showNames = workspace.inlayHintsEnabled('parameterNames');
    const showValues = workspace.inlayHintsEnabled('values');
    for (const argumentList of collect(tree.getRoot(), new Set([SyntaxKind.ArgumentList]), [])) {
        if (!inRange(argumentList)) continue;
        const args = argumentList.getChildren().filter(c => !isRedToken(c));
        for (const arg of args) {
            if (!LITERALS.has(arg.kind)) continue;
            const info = argumentInfo(analysis, arg);
            if (!info) continue;

            // Parameter names help when there's more than one argument to tell apart
            if (showNames && args.length > 1 && info.parameter.length > 1) {
                hints.push({
                    position: document.positionAt(arg.span.start),
                    label: `${info.parameter}:`,
                    kind: InlayHintKind.Parameter,
                    paddingRight: true,
                });
            }

            // (0 typically stands for "the current value" in these control codes, not entry 0)
            if (showValues && info.domain && numericValue(arg) !== 0) {
                const found = await entryForArgument(workspace, project, analysis, arg);
                if (found?.entry?.name) {
                    hints.push({
                        position: document.positionAt(arg.span.start + arg.span.length),
                        label: truncate(found.entry.name),
                        kind: InlayHintKind.Type,
                        paddingLeft: true,
                        tooltip: `${DOMAIN_TITLES[found.domain]} ${found.value}: ${found.entry.name}`,
                    });
                }
            }
        }
    }

    // Large literals (addresses) that a constant names, e.g. 0xC2AB79 = Smash
    if (showValues) {
        const constants = constantsByValue(workspace);
        for (const token of tree.getTokens()) {
            if (token.kind !== SyntaxKind.HexLiteral || !inRange(token)) continue;
            const value = numericValue(token);
            if (value === undefined || value < ADDRESS_THRESHOLD) continue;
            // Not the constant's own definition
            const definition = token.parent?.parent;
            if (definition?.kind === SyntaxKind.ConstantDeclaration) continue;

            const names = [...new Set((constants.get(value) ?? []).map(s => s.name))];
            if (names.length > 0) {
                hints.push({
                    position: document.positionAt(token.span.start + token.span.length),
                    label: `= ${names.slice(0, 2).join(', ')}${names.length > 2 ? ', …' : ''}`,
                    kind: InlayHintKind.Type,
                    paddingLeft: true,
                    tooltip: `Same value as ${names.join(', ')}`,
                });
            }
        }
    }

    // Raw control codes in strings: the commands they encode, e.g. "[1C 02 03]" name(Jeff)
    if (workspace.inlayHintsEnabled('controlCodes')) {
        const decoder = controlCodeDecoder(workspace);
        const describeLabel = labelTextResolver(workspace);
        for (const group of controlCodeGroupsInStrings(tree, start, end)) {
            const codes = decoder.decode(group.bytes);
            // Not on a command's own definition (command next "[03]")
            const command = group.command;
            if (command && codes.some(c => c.matches[0]?.pattern.command.declaration.span.start === command.span.start)) {
                continue;
            }

            const labels: string[] = [];
            const details: string[] = [];
            for (const code of codes) {
                const bytes = group.bytes.slice(code.start, code.start + code.length)
                    .map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                const best = code.matches[0];
                if (!best) {
                    if (labels[labels.length - 1] !== '…') labels.push('…');
                    details.push(`- \`${bytes}\` · unknown`);
                    continue;
                }
                // Arguments that name game data are shown by name
                const names = new Map<string, string>();
                for (const [parameter, value] of best.arguments) {
                    const domain = domainOfParameter(parameter);
                    if (domain && value !== 0 && project) {
                        const entry = await project.entry(domain, value, describeLabel);
                        if (entry?.name) names.set(parameter, entry.name);
                    }
                }
                labels.push(formatCall(best, (parameter, value) => names.get(parameter) ?? formatNumber(value)));
                details.push(`- \`${bytes}\` · \`${formatCall(best, (_, value) => formatNumber(value))}\``);
            }
            if (labels.every(l => l === '…')) continue;

            hints.push({
                position: document.positionAt(group.close + 1),
                label: truncate(labels.join(' '), 60),
                paddingLeft: true,
                paddingRight: true,
                tooltip: { kind: MarkupKind.Markdown, value: details.join('\n') },
            });
        }
    }

    // Labels whose text project tables point at
    if (project && workspace.inlayHintsEnabled('tableReferences')) {
        const references = await project.tableReferences();
        for (const statement of collect(tree.getRoot(), new Set([SyntaxKind.LabelDeclaration]), [])) {
            if (!inRange(statement)) continue;
            const symbol = analysis.binding.symbols.getSymbolAt(statement.span.start, analysis.filePath);
            if (!symbol || symbol.kind !== SymbolKind.Label || symbol.scopeId !== 0) continue;
            const uses = references.get(`${module.name}.${symbol.name}`);
            if (!uses || uses.length === 0) continue;

            const first = uses[0];
            const title = tableTitle(first.file);
            let label = first.id !== undefined ? `${title} ${first.id}` : title;
            const domain = domainOfTable(first.file);
            if (first.id !== undefined && domain && domain !== 'npc') {
                const entry = await project.entry(domain, first.id);
                if (entry?.name) label += ` ${truncate(entry.name, 24)}`;
            }
            if (uses.length > 1) label += ` +${uses.length - 1}`;

            hints.push({
                position: document.positionAt(statement.span.start + statement.span.length),
                label: `← ${label}`,
                paddingLeft: true,
                tooltip: {
                    kind: MarkupKind.Markdown,
                    value: uses.map(u => `- [${tableTitle(u.file)}${u.id !== undefined ? ` ${u.id}` : ''} · ${u.field}](` +
                        `${pathToUri(u.file)}#L${u.line + 1})`).join('\n'),
                },
            });
        }
    }

    return hints;
}
