import {
    DefinitionParams,
    DocumentHighlight,
    DocumentHighlightKind,
    DocumentHighlightParams,
    Location,
    PrepareRenameParams,
    Range,
    ReferenceParams,
    RenameParams,
    ResponseError,
    ErrorCodes,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver/node';
import { Symbol, SymbolKind } from 'ccscript-core';
import { entryForArgument, numericLiteralAt } from '../gameData';
import {
    declarationOf,
    findOccurrences,
    findTarget,
    toLocation,
    toRange,
} from '../symbols';
import { Analysis, Workspace, pathToUri } from '../workspace';

const KEYWORDS = new Set([
    'if', 'else', 'menu', 'default', 'define', 'command', 'or', 'and', 'not', 'flag', 'byte',
    'short', 'long', 'ROM', 'ROMTBL', 'import', 'count', 'setcount', 'insertbin',
]);

export async function provideDefinition(workspace: Workspace, analysis: Analysis, params: DefinitionParams): Promise<Location | null> {
    const offset = analysis.document.offsetAt(params.position);

    // A number passed as an item, character, etc.: its entry in the project's table
    const literal = numericLiteralAt(analysis, offset);
    if (literal) {
        const project = await workspace.projectFor(analysis.filePath);
        const found = await entryForArgument(workspace, project, analysis, literal);
        return found?.entry
            ? Location.create(pathToUri(found.entry.file), Range.create(found.entry.line, 0, found.entry.line, 0))
            : null;
    }

    const target = findTarget(workspace, analysis, offset);
    if (!target) {
        return null;
    }
    if (target.kind === 'module') {
        return target.module ? toLocation(workspace, target.module, { start: 0, length: 0 }) : null;
    }
    const declaration = declarationOf(workspace, target.symbol);
    return declaration ? toLocation(workspace, declaration.module, declaration.span) : null;
}

export async function provideReferences(workspace: Workspace, analysis: Analysis, params: ReferenceParams): Promise<Location[]> {
    const target = findTarget(workspace, analysis, analysis.document.offsetAt(params.position));
    if (!target || target.kind !== 'symbol') {
        return [];
    }
    const locations = findOccurrences(workspace, target.symbol)
        .filter(o => params.context.includeDeclaration || !o.isDeclaration)
        .map(o => toLocation(workspace, o.module, o.span));

    // Project tables that point at a label's text
    const declaration = declarationOf(workspace, target.symbol);
    if (target.symbol.kind === SymbolKind.Label && target.symbol.scopeId === 0 && declaration) {
        const project = await workspace.projectFor(declaration.module.filePath);
        const uses = project && (await project.tableReferences()).get(`${declaration.module.name}.${target.symbol.name}`);
        for (const use of uses ?? []) {
            locations.push(Location.create(pathToUri(use.file), Range.create(use.line, 0, use.line, 0)));
        }
    }
    return locations;
}

export function provideDocumentHighlights(workspace: Workspace, analysis: Analysis, params: DocumentHighlightParams): DocumentHighlight[] {
    const target = findTarget(workspace, analysis, analysis.document.offsetAt(params.position));
    if (!target || target.kind !== 'symbol') {
        return [];
    }
    return findOccurrences(workspace, target.symbol)
        .filter(o => o.module.filePath === analysis.filePath)
        .map(o => DocumentHighlight.create(
            toRange(workspace, o.module, o.span),
            o.isDeclaration ? DocumentHighlightKind.Write : DocumentHighlightKind.Read
        ));
}

/**
 * Why a symbol can't be renamed, if it can't.
 */
function renameBlocker(workspace: Workspace, symbol: Symbol): string | undefined {
    const declaration = declarationOf(workspace, symbol);
    if (!declaration) {
        return `Can't find where '${symbol.name}' is declared.`;
    }
    if (workspace.isStandardLibrary(declaration.module.filePath)) {
        return `'${symbol.name}' is declared in the standard library.`;
    }
    const root = workspace.rootPath;
    if (root && workspace.fileSystem.relative(root, declaration.module.filePath).startsWith('..')) {
        return `'${symbol.name}' is declared outside the workspace.`;
    }
    return undefined;
}

export function prepareRename(workspace: Workspace, analysis: Analysis, params: PrepareRenameParams): { range: Range; placeholder: string } | null {
    const target = findTarget(workspace, analysis, analysis.document.offsetAt(params.position));
    if (!target || target.kind !== 'symbol') {
        throw new ResponseError(ErrorCodes.InvalidRequest, 'You can only rename commands, constants, labels and parameters.');
    }
    const blocker = renameBlocker(workspace, target.symbol);
    if (blocker) {
        throw new ResponseError(ErrorCodes.InvalidRequest, blocker);
    }
    return {
        range: toRange(workspace, analysis.module, target.token.span),
        placeholder: target.token.text,
    };
}

export function provideRename(workspace: Workspace, analysis: Analysis, params: RenameParams): WorkspaceEdit | null {
    const target = findTarget(workspace, analysis, analysis.document.offsetAt(params.position));
    if (!target || target.kind !== 'symbol') {
        return null;
    }

    const newName = params.newName;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || KEYWORDS.has(newName)) {
        throw new ResponseError(ErrorCodes.InvalidParams, `'${newName}' isn't a valid name.`);
    }
    const blocker = renameBlocker(workspace, target.symbol);
    if (blocker) {
        throw new ResponseError(ErrorCodes.InvalidRequest, blocker);
    }

    const changes: { [uri: string]: TextEdit[] } = {};
    for (const occurrence of findOccurrences(workspace, target.symbol)) {
        const uri = workspace.uriFor(occurrence.module);
        (changes[uri] ??= []).push(TextEdit.replace(toRange(workspace, occurrence.module, occurrence.span), newName));
    }
    return { changes };
}
