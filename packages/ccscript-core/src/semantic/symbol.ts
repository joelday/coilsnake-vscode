/**
 * Symbol table for CCScript semantic analysis.
 * Tracks declarations and their properties.
 */

import { Type } from './types';
import { RedNode, RedToken } from '../redNode';

/**
 * Symbol kinds for different declaration types.
 */
export enum SymbolKind {
    /** Constant definition (define) */
    Constant,
    /** Variable definition */
    Variable,
    /** Command definition */
    Command,
    /** Label definition */
    Label,
    /** Parameter in a command */
    Parameter,
    /** Imported module */
    Module,
}

/**
 * Represents a symbol (declaration) in the program.
 */
export interface Symbol {
    /** Unique identifier for this symbol across the entire program (format: filePath:scopeId:kind:name) */
    id: string;
    /** The name of the symbol */
    name: string;
    /** The kind of symbol */
    kind: SymbolKind;
    /** The type of the symbol */
    type: Type;
    /** The AST node where the symbol is declared */
    declaration: RedNode;
    /** The identifier token for this symbol (authoritative reference) */
    identifierNode: RedToken;
    /** The position in the source where the symbol's identifier starts (after leading trivia) */
    position: number;
    /** The length of the identifier */
    length: number;
    /** The scope this symbol belongs to */
    scopeId: number;
    /** Whether this symbol has been used */
    isUsed: boolean;
    /** For commands: list of parameter symbols */
    parameters?: Symbol[];
    /** The file where this symbol was declared */
    modulePath?: string;
}

/**
 * A read-only table consulted after a table's own symbols, optionally filtered.
 */
export interface SymbolTableLayer {
    table: SymbolTable;
    /** Only symbols passing this filter are visible through the layer */
    filter?: (symbol: Symbol) => boolean;
}

/**
 * Symbol table for storing and looking up symbols.
 *
 * A table can see through to fallback layers (e.g. imported and shared symbols) without
 * copying them. Lookups prefer the table's own symbols, then each layer in order.
 */
export class SymbolTable {
    /** Map from symbol name to symbol */
    private symbols: Map<string, Symbol[]> = new Map();

    /** All symbols in declaration order */
    private allSymbols: Symbol[] = [];

    /** Set of symbol IDs to prevent duplicates */
    private symbolIds: Set<string> = new Set();

    /** Scopes that this table's own symbols belong to (lets lookups skip tables quickly) */
    private scopeIds: Set<number> = new Set();

    /**
     * @param layers Fallback tables, highest priority first
     */
    constructor(private readonly layers: readonly SymbolTableLayer[] = []) { }

    /**
     * Adds a symbol to the table.
     * Only adds if the symbol ID is not already present (prevents duplicates).
     */
    add(symbol: Symbol): void {
        // Check if this symbol ID already exists
        if (this.symbolIds.has(symbol.id)) {
            return; // Already present, don't duplicate
        }

        // Mark this ID as added
        this.symbolIds.add(symbol.id);
        this.scopeIds.add(symbol.scopeId);

        const existing = this.symbols.get(symbol.name);
        if (existing) {
            existing.push(symbol);
        } else {
            this.symbols.set(symbol.name, [symbol]);
        }
        this.allSymbols.push(symbol);
    }

    /**
     * Looks up a symbol by name in a given scope.
     * Searches scopes from innermost to outermost (proper shadowing). Within a scope, the
     * table's own symbols win over its layers, and later declarations win over earlier ones.
     * @param name The symbol name to look up
     * @param scopeOrder Array of scope IDs from innermost to outermost
     * @param kind If provided, only symbols of this kind are considered
     */
    lookup(name: string, scopeOrder: number[], kind?: SymbolKind): Symbol | undefined {
        for (const scopeId of scopeOrder) {
            const symbol = this.lookupInScope(name, scopeId, kind);
            if (symbol) {
                return symbol;
            }
        }
        return undefined;
    }

    private lookupInScope(
        name: string,
        scopeId: number,
        kind: SymbolKind | undefined,
        filter?: (symbol: Symbol) => boolean
    ): Symbol | undefined {
        // Most recently declared own symbol first
        const candidates = this.scopeIds.has(scopeId) ? this.symbols.get(name) : undefined;
        if (candidates) {
            for (let i = candidates.length - 1; i >= 0; i--) {
                const symbol = candidates[i];
                if (symbol.scopeId === scopeId &&
                    (kind === undefined || symbol.kind === kind) &&
                    (!filter || filter(symbol))) {
                    return symbol;
                }
            }
        }

        for (const layer of this.layers) {
            const layerFilter = layer.filter;
            const combined = filter && layerFilter
                ? (symbol: Symbol) => filter(symbol) && layerFilter(symbol)
                : filter ?? layerFilter;
            const symbol = layer.table.lookupInScope(name, scopeId, kind, combined);
            if (symbol) {
                return symbol;
            }
        }

        return undefined;
    }

    /**
     * Gets the symbols with a given name added directly to this table (excluding layers).
     */
    getOwn(name: string): readonly Symbol[] {
        return this.symbols.get(name) || [];
    }

    /**
     * Gets all symbols with a given name (layers first, then own, in declaration order).
     */
    getAll(name: string): Symbol[] {
        if (this.layers.length === 0) {
            return this.symbols.get(name) || [];
        }
        return this.dedupe([
            ...this.layers.slice().reverse().flatMap(l => this.visible(l, l.table.getAll(name))),
            ...(this.symbols.get(name) || []),
        ]);
    }

    /**
     * Gets all symbols in the table, including those visible through layers.
     */
    getAllSymbols(): Symbol[] {
        if (this.layers.length === 0) {
            return [...this.allSymbols];
        }
        return this.dedupe([
            ...this.layers.slice().reverse().flatMap(l => this.visible(l, l.table.getAllSymbols())),
            ...this.allSymbols,
        ]);
    }

    /**
     * Gets symbols by kind.
     */
    getByKind(kind: SymbolKind): Symbol[] {
        return this.getAllSymbols().filter(s => s.kind === kind);
    }

    /**
     * Looks up a symbol by its unique ID.
     */
    getById(id: string): Symbol | undefined {
        return this.getAllSymbols().find(s => s.id === id);
    }

    /**
     * Gets the symbol at a specific position.
     * Only returns symbols declared in the given file (modulePath is undefined or matches).
     * Uses the authoritative identifier node position and length for precise matching.
     */
    getSymbolAt(position: number, filePath?: string): Symbol | undefined {
        return this.getAllSymbols().find(s => {
            // Skip symbols from other modules
            if (s.modulePath && filePath && s.modulePath !== filePath) {
                return false;
            }

            // Use the authoritative identifier position and length
            const start = s.position;
            const end = start + s.length;
            return position >= start && position < end;
        });
    }

    /**
     * Gets all symbols visible at a specific scope.
     * Imported symbols have scopeId 0 (global), so they're visible everywhere.
     */
    getVisibleSymbols(visibleScopes: Set<number>): Symbol[] {
        return this.getAllSymbols().filter(s => visibleScopes.has(s.scopeId));
    }

    /**
     * Clears the table's own symbols (layers are unaffected).
     */
    clear(): void {
        this.symbols.clear();
        this.allSymbols = [];
        this.symbolIds.clear();
        this.scopeIds.clear();
    }

    /**
     * Creates a flattened shallow copy of this symbol table.
     */
    clone(): SymbolTable {
        const newTable = new SymbolTable();
        newTable.merge(this);
        return newTable;
    }

    /**
     * Merges another symbol table into this one.
     * Adds all symbols from the other table.
     */
    merge(other: SymbolTable): void {
        for (const symbol of other.getAllSymbols()) {
            this.add(symbol);
        }
    }

    private visible(layer: SymbolTableLayer, symbols: Symbol[]): Symbol[] {
        return layer.filter ? symbols.filter(layer.filter) : symbols;
    }

    private dedupe(symbols: Symbol[]): Symbol[] {
        const seen = new Set<string>();
        return symbols.filter(s => !seen.has(s.id) && (seen.add(s.id), true));
    }
}
