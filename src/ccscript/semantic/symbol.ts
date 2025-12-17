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
}

/**
 * Represents a symbol (declaration) in the program.
 */
export interface Symbol {
    /** The name of the symbol */
    name: string;
    /** The kind of symbol */
    kind: SymbolKind;
    /** The type of the symbol */
    type: Type;
    /** The AST node where the symbol is declared */
    declaration: RedNode;
    /** The position in the source where the symbol is declared */
    position: number;
    /** The scope this symbol belongs to */
    scopeId: number;
    /** Whether this symbol has been used */
    isUsed: boolean;
    /** For commands: list of parameter symbols */
    parameters?: Symbol[];
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
     * Returns the most recently declared symbol visible in the scope.
     */
    lookup(name: string, scopeId: number, visibleScopes: Set<number>): Symbol | undefined {
        const candidates = this.symbols.get(name);
        if (!candidates) {
            return undefined;
        }

        // Find the most recently declared symbol visible in the scope
        // Search in reverse order (most recent first)
        for (let i = candidates.length - 1; i >= 0; i--) {
            const symbol = candidates[i];
            if (visibleScopes.has(symbol.scopeId)) {
                return symbol;
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
     * Gets the symbol at a specific position.
     */
    getSymbolAt(position: number): Symbol | undefined {
        return this.allSymbols.find(s => {
            const node = s.declaration;
            const start = node.position;
            const end = start + node.width;
            return position >= start && position < end;
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
