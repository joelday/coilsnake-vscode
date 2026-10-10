import { Hover, HoverParams, MarkupKind } from 'vscode-languageserver/node';
import { describeSymbol, findTarget, getDocComment, symbolKindName } from '../symbols';
import { Analysis, Workspace } from '../workspace';

export function provideHover(workspace: Workspace, analysis: Analysis, params: HoverParams): Hover | null {
    const offset = analysis.document.offsetAt(params.position);
    const target = findTarget(workspace, analysis, offset);
    if (!target) {
        return null;
    }

    const fs = workspace.fileSystem;
    const relative = (filePath: string) =>
        fs.relative(fs.dirname(analysis.filePath), filePath).replace(/\\/g, '/');
    const range = {
        start: analysis.document.positionAt(target.token.span.start),
        end: analysis.document.positionAt(target.token.span.start + target.token.span.length),
    };

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
    if (declaringModule && declaringModule.filePath !== analysis.filePath) {
        const where = workspace.isStandardLibrary(declaringModule.filePath) ? 'standard library' : relative(declaringModule.filePath);
        parts.push(`*${symbolKindName(symbol.kind)} from ${where}*`);
    }

    return { contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') }, range };
}
