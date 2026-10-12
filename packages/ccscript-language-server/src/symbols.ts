/**
 * Shared helpers for finding symbols and describing them.
 */

import { Location, Range } from 'vscode-languageserver/node';
import {
    Module,
    RedNode,
    RedToken,
    Symbol,
    SymbolKind,
    SyntaxKind,
    SyntaxTree,
    isRedToken,
} from 'ccscript-core';
import { Analysis, Workspace } from './workspace';

export interface Span {
    start: number;
    length: number;
}

/**
 * What's under the cursor: a declared or referenced symbol, or a module name
 * (an import, or the `module` in `module.member`).
 */
export type Target =
    | { kind: 'symbol'; symbol: Symbol; token: RedToken; isDeclaration: boolean }
    | { kind: 'module'; module: Module | undefined; name: string; token: RedToken };

export interface Occurrence {
    module: Module;
    span: Span;
    isDeclaration: boolean;
}

/**
 * The token whose text contains the offset, or ends at it (a cursor just after a word).
 */
export function tokenAt(tree: SyntaxTree, offset: number, kinds: SyntaxKind[] = [SyntaxKind.Identifier]): RedToken | undefined {
    for (const candidate of [offset, offset - 1]) {
        if (candidate < 0) {
            continue;
        }
        const token = tree.getTokenAtPosition(candidate);
        if (token && kinds.includes(token.kind) &&
            token.span.start <= offset && offset <= token.span.start + token.span.length) {
            return token;
        }
    }
    return undefined;
}

/**
 * The span of the name a reference node refers to: the identifier, or the member of a
 * qualified name.
 */
export function referenceNameSpan(node: RedNode): Span {
    const identifiers = node.getChildren().filter(c => c.kind === SyntaxKind.Identifier);
    const token = node.kind === SyntaxKind.QualifiedNameExpression
        ? identifiers[identifiers.length - 1]
        : identifiers[0];
    return (token ?? node).span;
}

/**
 * Import path text as written (quotes removed), and the module name it refers to.
 */
export function importInfo(statement: RedNode): { token: RedToken; path: string; moduleName: string } | undefined {
    const token = statement.getChildren().find(c =>
        c.kind === SyntaxKind.Identifier || c.kind === SyntaxKind.StringLiteral);
    if (!token || !isRedToken(token)) {
        return undefined;
    }
    const isString = token.kind === SyntaxKind.StringLiteral;
    const path = isString ? token.text.replace(/^"|"$/g, '') : `${token.text}.ccs`;
    const base = path.split(/[\\/]/).pop() ?? path;
    return { token, path, moduleName: base.replace(/\.ccs$/i, '') };
}

export function findTarget(workspace: Workspace, analysis: Analysis, offset: number): Target | undefined {
    const { tree, binding, filePath, module } = analysis;

    // Import statement path
    const importToken = tokenAt(tree, offset, [SyntaxKind.Identifier, SyntaxKind.StringLiteral]);
    if (importToken?.parent?.kind === SyntaxKind.ImportStatement) {
        const info = importInfo(importToken.parent);
        if (info) {
            const imported = module.dependencies.find(d => d.name === info.moduleName);
            return { kind: 'module', module: imported, name: info.moduleName, token: importToken };
        }
    }

    const token = tokenAt(tree, offset);
    if (!token) {
        return undefined;
    }
    const parent = token.parent;

    // The module part of `module.member`
    if (parent?.kind === SyntaxKind.QualifiedNameExpression && parent.getChildren()[0] === token) {
        return {
            kind: 'module',
            module: workspace.program.getModuleByName(token.text),
            name: token.text,
            token,
        };
    }

    // A declaration
    const declared = binding.symbols.getSymbolAt(token.span.start, filePath);
    if (declared && declared.position === token.span.start && declared.kind !== SymbolKind.Module) {
        return { kind: 'symbol', symbol: declared, token, isDeclaration: true };
    }

    // A reference
    const referenced = parent && binding.references.get(parent);
    if (referenced) {
        return { kind: 'symbol', symbol: referenced, token, isDeclaration: false };
    }

    return undefined;
}

/**
 * Every place a symbol is declared or referenced, across all loaded modules.
 */
export function findOccurrences(workspace: Workspace, symbol: Symbol): Occurrence[] {
    const program = workspace.program;
    const occurrences: Occurrence[] = [];
    const declaringModule = symbol.modulePath ? program.getModule(symbol.modulePath) : undefined;

    if (declaringModule) {
        occurrences.push({
            module: declaringModule,
            span: { start: symbol.position, length: symbol.length },
            isDeclaration: true,
        });
    }

    // Locals (parameters, labels in blocks) can only be referenced from their own module
    const modules = symbol.scopeId !== 0 && declaringModule ? [declaringModule] : program.getAllModules();
    for (const module of modules) {
        if (!module.binding) {
            continue;
        }
        for (const [node, referenced] of module.binding.references) {
            if (referenced.id === symbol.id) {
                occurrences.push({ module, span: referenceNameSpan(node), isDeclaration: false });
            }
        }
    }

    // A reference can coincide with the declaration (e.g. a label's own token); keep one
    const seen = new Set<string>();
    return occurrences.filter(o => {
        const key = `${o.module.filePath}:${o.span.start}`;
        return !seen.has(key) && (seen.add(key), true);
    });
}

export function toRange(workspace: Workspace, module: Module, span: Span): Range {
    const document = workspace.textDocumentFor(module);
    return Range.create(document.positionAt(span.start), document.positionAt(span.start + span.length));
}

export function toLocation(workspace: Workspace, module: Module, span: Span): Location {
    return Location.create(workspace.uriFor(module), toRange(workspace, module, span));
}

/**
 * Where a symbol is declared, if its module is loaded.
 */
export function declarationOf(workspace: Workspace, symbol: Symbol): { module: Module; span: Span } | undefined {
    const module = symbol.modulePath ? workspace.program.getModule(symbol.modulePath) : undefined;
    return module ? { module, span: { start: symbol.position, length: symbol.length } } : undefined;
}

// ========== Describing symbols ==========

export function getParameterNames(symbol: Symbol): string[] {
    const parameterList = symbol.declaration.getChildren().find(c => c.kind === SyntaxKind.ParameterList);
    return parameterList
        ? parameterList.getChildren().filter(isRedToken).filter(t => t.kind === SyntaxKind.Identifier).map(t => t.text)
        : [];
}

function sourceOf(node: RedNode, source: string): string {
    return source.slice(node.span.start, node.span.start + node.span.length);
}

function oneLine(text: string, maxLength = 120): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/**
 * A one-line, code-formatted summary of a symbol, e.g. `command name(a, b)` or `define X = 3`.
 */
export function describeSymbol(symbol: Symbol, source: string | undefined): string {
    const declaration = symbol.declaration;
    switch (symbol.kind) {
        case SymbolKind.Command: {
            const signature = `command ${symbol.name}(${getParameterNames(symbol).join(', ')})`;
            // Show short bodies, which are usually a control code string
            const body = declaration.getChildren().filter(c => !isRedToken(c) && c.kind !== SyntaxKind.ParameterList).pop();
            if (body && source && body.kind !== SyntaxKind.BlockStatement) {
                const text = sourceOf(body, source);
                if (!text.includes('\n') && text.length <= 80) {
                    return `${signature} ${text}`;
                }
            }
            return signature;
        }
        case SymbolKind.Constant: {
            const value = declaration.getChildren().filter(c => !isRedToken(c)).pop();
            return value && source
                ? `define ${symbol.name} = ${oneLine(sourceOf(value, source))}`
                : `define ${symbol.name}`;
        }
        case SymbolKind.Label:
            return `${symbol.name}:`;
        case SymbolKind.Parameter:
            return `(parameter) ${symbol.name}`;
        case SymbolKind.Module:
            return `import ${symbol.name}`;
        default:
            return symbol.name;
    }
}

/**
 * Documentation comments for a declaration: `//` or `/* *\/` comment lines directly above it,
 * or a comment at the end of its line (common for one-line commands).
 */
export function getDocComment(symbol: Symbol, source: string | undefined): string | undefined {
    if (!source || symbol.kind === SymbolKind.Parameter || symbol.kind === SymbolKind.Module) {
        return undefined;
    }

    const start = symbol.declaration.span.start;
    const end = start + symbol.declaration.span.length;
    const lines: string[] = [];

    // Comment lines immediately above (no blank line in between)
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    if (/^\s*$/.test(source.slice(lineStart, start))) {
        const above = source.slice(0, lineStart).split(/\r?\n/);
        above.pop(); // The (empty) remainder after the last newline
        let i = above.length - 1;
        while (i >= 0) {
            const single = above[i].match(/^\s*\/\/+\s?(.*)$/);
            if (single) {
                lines.unshift(single[1].trimEnd());
                i--;
                continue;
            }

            // A block comment that occupies whole lines
            if (/\*\/\s*$/.test(above[i])) {
                let first = i;
                while (first >= 0 && !above[first].includes('/*')) {
                    first--;
                }
                if (first < 0 || !/^\s*\/\*/.test(above[first])) {
                    break;
                }
                const block = above.slice(first, i + 1).join('\n')
                    .replace(/^\s*\/\*+/, '')
                    .replace(/\*+\/\s*$/, '');
                lines.unshift(...block.split('\n').map(line => line.replace(/^\s*\*?\s?/, '').trimEnd()));
                i = first - 1;
                continue;
            }
            break;
        }
    }

    // A trailing comment on the declaration's last line
    const lineEnd = source.indexOf('\n', end);
    const rest = source.slice(end, lineEnd === -1 ? undefined : lineEnd);
    const trailing = rest.match(/^\s*\/\/+\s?(.*?)\s*$/) ?? rest.match(/^\s*\/\*+\s?(.*?)\s*\*\/\s*$/);
    if (trailing && trailing[1]) {
        lines.push(trailing[1]);
    }

    const text = lines.join('\n').trim();
    return text || undefined;
}

export function symbolKindName(kind: SymbolKind): string {
    switch (kind) {
        case SymbolKind.Command: return 'command';
        case SymbolKind.Constant: return 'constant';
        case SymbolKind.Label: return 'label';
        case SymbolKind.Parameter: return 'parameter';
        case SymbolKind.Module: return 'module';
        default: return 'symbol';
    }
}
