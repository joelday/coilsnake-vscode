/**
 * Helpers for adding imports to a module.
 */

import { Position, TextEdit } from 'vscode-languageserver/node';
import { Module, SyntaxKind } from 'ccscript-core';
import { Analysis, Workspace } from './workspace';

/**
 * Where to insert a new import: after the last import, or at the top of the file.
 */
export function importInsertion(analysis: Analysis): { position: Position; prefix: string; suffix: string } {
    const imports = analysis.tree.getStatements().filter(s => s.kind === SyntaxKind.ImportStatement);
    if (imports.length > 0) {
        const last = imports[imports.length - 1];
        return { position: analysis.document.positionAt(last.span.start + last.span.length), prefix: '\n', suffix: '' };
    }
    return { position: Position.create(0, 0), prefix: '', suffix: '\n' };
}

/**
 * The path to import a module by, relative to the analyzed file.
 */
export function importPath(workspace: Workspace, analysis: Analysis, target: Module): string {
    const fs = workspace.fileSystem;
    return fs.relative(fs.dirname(analysis.filePath), target.filePath).replace(/\\/g, '/');
}

/**
 * An edit adding imports of the given modules.
 */
export function importEdit(workspace: Workspace, analysis: Analysis, targets: Module[]): TextEdit {
    const insertion = importInsertion(analysis);
    const lines = targets.map(t => `import "${importPath(workspace, analysis, t)}"`).join('\n');
    return TextEdit.insert(insertion.position, `${insertion.prefix}${lines}${insertion.suffix}`);
}
