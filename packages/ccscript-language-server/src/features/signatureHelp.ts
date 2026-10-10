import {
    MarkupKind,
    ParameterInformation,
    SignatureHelp,
    SignatureHelpParams,
} from 'vscode-languageserver/node';
import { RedNode, SymbolKind, SyntaxKind } from 'ccscript-core';
import { getDocComment, getParameterNames } from '../symbols';
import { Analysis, Workspace } from '../workspace';

/**
 * The innermost call whose argument list contains the offset (after its '(' and up to its ')').
 */
function findCall(analysis: Analysis, offset: number): { call: RedNode; argumentList: RedNode } | undefined {
    for (const position of [offset, offset - 1]) {
        if (position < 0) continue;
        for (let node: RedNode | null = analysis.tree.getNodeAtPosition(position); node; node = node.parent) {
            if (node.kind !== SyntaxKind.CallExpression) continue;
            const argumentList = node.getChildren().find(c => c.kind === SyntaxKind.ArgumentList);
            if (!argumentList) continue;

            const children = argumentList.getChildren();
            const open = children[0];
            const close = children[children.length - 1];
            const closed = close.kind === SyntaxKind.CloseParenToken;
            if (offset > open.span.start && (!closed || offset <= close.span.start)) {
                return { call: node, argumentList };
            }
        }
    }
    return undefined;
}

export function provideSignatureHelp(workspace: Workspace, analysis: Analysis, params: SignatureHelpParams): SignatureHelp | null {
    const offset = analysis.document.offsetAt(params.position);
    const found = findCall(analysis, offset);
    if (!found) {
        return null;
    }

    const callee = found.call.getChildren()[0];
    const symbol = analysis.binding.references.get(callee);
    if (!symbol || symbol.kind !== SymbolKind.Command) {
        return null;
    }

    const parameters = getParameterNames(symbol);
    const label = `${symbol.name}(${parameters.join(', ')})`;

    // Parameter labels as offsets into the signature label, so the client can highlight them
    let cursor = symbol.name.length + 1;
    const parameterInfos: ParameterInformation[] = parameters.map(name => {
        const info: ParameterInformation = { label: [cursor, cursor + name.length] };
        cursor += name.length + 2;
        return info;
    });

    const commas = found.argumentList.getChildren()
        .filter(c => c.kind === SyntaxKind.CommaToken && c.span.start < offset).length;

    const declaringModule = symbol.modulePath ? workspace.program.getModule(symbol.modulePath) : undefined;
    const docs = getDocComment(symbol, declaringModule?.tree.source);

    return {
        signatures: [{
            label,
            documentation: docs ? { kind: MarkupKind.Markdown, value: docs } : undefined,
            parameters: parameterInfos,
        }],
        activeSignature: 0,
        activeParameter: parameters.length === 0 ? 0 : Math.min(commas, parameters.length - 1),
    };
}
