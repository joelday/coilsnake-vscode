/**
 * Scope management for CCScript semantic analysis.
 * Handles scope hierarchy and identifier visibility.
 */

/**
 * Scope kinds for different contexts.
 */
export enum ScopeKind {
    /** Global/file scope */
    Global,
    /** Command body scope */
    Command,
    /** Block scope */
    Block,
}

/**
 * Represents a lexical scope in the program.
 */
export interface Scope {
    /** Unique identifier for this scope */
    id: number;
    /** The kind of scope */
    kind: ScopeKind;
    /** The parent scope (undefined for global) */
    parent?: Scope;
    /** Child scopes */
    children: Scope[];
}

/**
 * Manages the scope hierarchy for a program.
 */
export class ScopeManager {
    /** The global scope */
    private globalScope: Scope;

    /** All scopes indexed by ID */
    private scopes: Map<number, Scope> = new Map();

    /** Next scope ID */
    private nextScopeId = 0;

    constructor() {
        this.globalScope = this.createScope(ScopeKind.Global);
    }

    /**
     * Creates a new scope.
     */
    private createScope(kind: ScopeKind, parent?: Scope): Scope {
        const scope: Scope = {
            id: this.nextScopeId++,
            kind,
            parent,
            children: [],
        };

        this.scopes.set(scope.id, scope);

        if (parent) {
            parent.children.push(scope);
        }

        return scope;
    }

    /**
     * Gets the global scope.
     */
    getGlobalScope(): Scope {
        return this.globalScope;
    }

    /**
     * Creates a child scope.
     */
    createChildScope(kind: ScopeKind, parent: Scope): Scope {
        return this.createScope(kind, parent);
    }

    /**
     * Gets a scope by ID.
     */
    getScope(id: number): Scope | undefined {
        return this.scopes.get(id);
    }

    /**
     * Gets all ancestor scopes for a given scope (including itself).
     * Returns from innermost to outermost.
     */
    getAncestorScopes(scope: Scope): Scope[] {
        const ancestors: Scope[] = [];
        let current: Scope | undefined = scope;

        while (current) {
            ancestors.push(current);
            current = current.parent;
        }

        return ancestors;
    }

    /**
     * Gets the set of scope IDs visible from a given scope.
     * Includes the scope itself and all ancestor scopes.
     */
    getVisibleScopes(scope: Scope): Set<number> {
        const visible = new Set<number>();
        const ancestors = this.getAncestorScopes(scope);

        for (const ancestor of ancestors) {
            visible.add(ancestor.id);
        }

        return visible;
    }

    /**
     * Gets scope IDs visible from a given scope, ordered from innermost to outermost.
     * Used for proper symbol shadowing during lookup.
     */
    getVisibleScopeIds(scope: Scope): number[] {
        const ancestors = this.getAncestorScopes(scope);
        return ancestors.map(s => s.id);
    }

    /**
     * Checks if a scope is visible from another scope.
     */
    isVisible(fromScope: Scope, targetScope: Scope): boolean {
        const ancestors = this.getAncestorScopes(fromScope);
        return ancestors.some(s => s.id === targetScope.id);
    }
}
