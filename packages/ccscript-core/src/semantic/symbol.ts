/**
 * Symbol table for CCScript semantic analysis.
 * Tracks declarations and their properties.
 */

import { Type } from './types';
import { RedNode } from '../redNode';

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
    identifierNode: import('../redNode').RedToken;
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
    /** The module file path where this symbol was declared (for imported symbols) */
    modulePath?: string;
}

/**
 * Symbol table for storing and looking up symbols.
 */
export class SymbolTable {
    /** Map from symbol name to symbol */
    private symbols: Map<string, Symbol[]> = new Map();

    /** All symbols in declaration order */
    private allSymbols: Symbol[] = [];

    /**
     * Adds a symbol to the table.
     */
    add(symbol: Symbol): void {
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
     * Searches scopes from innermost to outermost (proper shadowing).
     * @param name The symbol name to look up
     * @param scopeOrder Array of scope IDs from innermost to outermost
     */
    lookup(name: string, scopeOrder: number[]): Symbol | undefined {
        const candidates = this.symbols.get(name);
        if (!candidates) {
            return undefined;
        }

        // Search each scope in order (innermost to outermost)
        for (const scopeId of scopeOrder) {
            // Find the most recently declared symbol in this specific scope
            for (let i = candidates.length - 1; i >= 0; i--) {
                const symbol = candidates[i];
                if (symbol.scopeId === scopeId) {
                    return symbol;
                }
            }
        }

        return undefined;
    }

    /**
     * Gets all symbols with a given name.
     */
    getAll(name: string): Symbol[] {
        return this.symbols.get(name) || [];
    }

    /**
     * Gets all symbols in the table.
     */
    getAllSymbols(): Symbol[] {
        return [...this.allSymbols];
    }

    /**
     * Gets symbols by kind.
     */
    getByKind(kind: SymbolKind): Symbol[] {
        return this.allSymbols.filter(s => s.kind === kind);
    }

    /**
     * Looks up a symbol by its unique ID.
     */
    getById(id: string): Symbol | undefined {
        return this.allSymbols.find(s => s.id === id);
    }

    /**
     * Gets the symbol at a specific position.
     * Only returns symbols declared in the current file (modulePath is undefined or matches).
     * Uses the authoritative identifier node position and length for precise matching.
     */
    getSymbolAt(position: number, filePath?: string): Symbol | undefined {
        return this.allSymbols.find(s => {
            // Skip imported symbols from other modules
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
     * Filters by visible scope IDs. Includes imported symbols (they're already in the table with the correct scope).
     */
    getVisibleSymbols(visibleScopes: Set<number>): Symbol[] {
        return this.allSymbols.filter(s => {
            // Only include symbols in visible scopes
            // Imported symbols are already in the table with scopeId: 0 (global), so they'll be visible
            return visibleScopes.has(s.scopeId);
        });
    }

    /**
     * Clears all symbols.
     */
    clear(): void {
        this.symbols.clear();
        this.allSymbols = [];
    }
}
