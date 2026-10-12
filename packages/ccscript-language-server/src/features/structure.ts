import { DocumentLink, FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { RedNode, SyntaxKind } from 'ccscript-core';
import { importInfo, toRange } from '../symbols';
import { Analysis, Workspace } from '../workspace';

const FOLDABLE = new Set([SyntaxKind.BlockStatement, SyntaxKind.MenuStatement, SyntaxKind.CommandDeclaration]);

export function provideFoldingRanges(analysis: Analysis): FoldingRange[] {
    const { document, tree } = analysis;
    const ranges: FoldingRange[] = [];
    const lineOf = (offset: number) => document.positionAt(offset).line;

    // Blocks, menus and commands that span lines (keeping the closing line visible)
    const visit = (node: RedNode) => {
        if (FOLDABLE.has(node.kind)) {
            const startLine = lineOf(node.span.start);
            const endLine = lineOf(node.span.start + node.span.length);
            if (endLine > startLine) {
                const closesWithBrace = node.kind !== SyntaxKind.CommandDeclaration ||
                    document.getText().charAt(node.span.start + node.span.length - 1) === '}';
                ranges.push(FoldingRange.create(startLine, closesWithBrace ? endLine - 1 : endLine));
            }
        }
        for (const child of node.getChildren()) {
            if (child.fullWidth > 0) visit(child);
        }
    };
    visit(tree.getRoot());

    // Text sections: each top-level label up to the next statement that's a label
    const statements = tree.getStatements();
    for (let i = 0; i < statements.length; i++) {
        if (statements[i].kind !== SyntaxKind.LabelDeclaration) continue;
        let next = i + 1;
        while (next < statements.length && statements[next].kind !== SyntaxKind.LabelDeclaration) next++;
        const last = statements[next - 1];
        const startLine = lineOf(statements[i].span.start);
        const endLine = lineOf(last.span.start + last.span.length);
        if (endLine > startLine) {
            ranges.push(FoldingRange.create(startLine, endLine));
        }
    }

    // Block comments, and runs of line comments
    const lines = document.getText().split(/\r?\n/);
    let runStart = -1;
    for (let line = 0; line <= lines.length; line++) {
        const isComment = line < lines.length && /^\s*\/\//.test(lines[line]);
        if (isComment && runStart < 0) runStart = line;
        if (!isComment && runStart >= 0) {
            if (line - 1 > runStart) ranges.push(FoldingRange.create(runStart, line - 1, undefined, undefined, FoldingRangeKind.Comment));
            runStart = -1;
        }
    }
    const text = document.getText();
    for (const match of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
        const startLine = lineOf(match.index!);
        const endLine = lineOf(match.index! + match[0].length);
        if (endLine > startLine) {
            ranges.push(FoldingRange.create(startLine, endLine, undefined, undefined, FoldingRangeKind.Comment));
        }
    }

    // Imports
    const imports = statements.filter(s => s.kind === SyntaxKind.ImportStatement);
    if (imports.length > 1) {
        const startLine = lineOf(imports[0].span.start);
        const endLine = lineOf(imports[imports.length - 1].span.start);
        if (endLine > startLine) {
            ranges.push(FoldingRange.create(startLine, endLine, undefined, undefined, FoldingRangeKind.Imports));
        }
    }

    return ranges;
}

export function provideDocumentLinks(workspace: Workspace, analysis: Analysis): DocumentLink[] {
    const links: DocumentLink[] = [];
    for (const statement of analysis.tree.getStatements()) {
        if (statement.kind !== SyntaxKind.ImportStatement) continue;
        const info = importInfo(statement);
        const target = info && analysis.module.dependencies.find(d => d.name === info.moduleName);
        if (!info || !target) continue;

        // Link the path text, without the quotes
        const span = info.token.kind === SyntaxKind.StringLiteral
            ? { start: info.token.span.start + 1, length: Math.max(0, info.token.span.length - 2) }
            : info.token.span;
        links.push(DocumentLink.create(toRange(workspace, analysis.module, span), workspace.uriFor(target)));
    }
    return links;
}
