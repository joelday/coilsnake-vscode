/**
 * Program/Project management for CCScript multi-file compilation.
 * Handles import resolution, dependency graph, and module loading.
 *
 * Architecture based on CCScript 1337 compiler's ProcessImports() in compiler.cpp:
 * - Start with explicitly loaded modules
 * - Process each module's imports recursively
 * - Search paths: (1) same dir as importing file, (2) project root, (3) lib directories
 * - Auto-include std.ccs and stdarg.ccs unless disabled
 * - Allow circular imports (each module is loaded once)
 * - Load modules on-demand
 */

import { FileSystem } from './fileSystem';
import { SyntaxTree } from './syntaxTree';
import { RedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import { Diagnostic, DiagnosticSeverity } from './syntax/types';
import { Binder, BindingResult, BindingContext } from './semantic/binder';
import { SymbolTable, SymbolKind } from './semantic/symbol';

/**
 * Modules in same directory form a compilation group.
 * CCScript's compilation model: files in the same directory share a global namespace.
 */
export interface CompilationGroup {
    /** Directory path */
    directory: string;
    /** Modules in this directory */
    modules: Module[];
    /** Shared symbol table for all modules in group (collected from all modules) */
    sharedDeclarations: SymbolTable;
    /** Track which groups this group depends on */
    dependsOn: Set<CompilationGroup>;
    /** Track which groups depend on this group */
    dependents: Set<CompilationGroup>;
}

/**
 * Represents a loaded module/source file in the program
 */
export interface Module {
    /** Absolute path to the file */
    readonly filePath: string;
    /** Module name (derived from filename, no extension) */
    readonly name: string;
    /** Parsed syntax tree */
    readonly tree: SyntaxTree;
    /** Import paths from import statements (raw, not resolved) */
    readonly imports: string[];
    /** Resolved modules that this module imports */
    readonly dependencies: Module[];
    /** The compilation group this module belongs to */
    group?: CompilationGroup;
    /** Semantic analysis result (bound against group + dependencies) */
    binding?: BindingResult;
}

/**
 * Program configuration options
 */
export interface ProgramOptions {
    /** File system implementation to use */
    fileSystem: FileSystem;
    /** Root directory for the project */
    rootPath: string;
    /** Library directories to search for imports */
    libPaths?: string[];
    /** Include std.ccs and stdarg.ccs automatically */
    includeStdLibs?: boolean;
    /** Standard library paths (if includeStdLibs is true) */
    stdLibPaths?: {
        std?: string;
        stdarg?: string;
    };
    /**
     * Load every .ccs file in a module's directory the first time that directory is seen,
     * since files in the same directory share a namespace (default: true)
     */
    loadSiblings?: boolean;
    /** Receives diagnostic trace messages (silent by default) */
    log?: (message: string) => void;
}

/**
 * Diagnostic for import resolution errors
 */
export interface ImportDiagnostic extends Diagnostic {
    /** File path where the import failed */
    filePath: string;
    /** The import path that couldn't be resolved */
    importPath: string;
}

/**
 * Program manages multiple source files and their dependencies.
 * Entry point for multi-file CCScript compilation and analysis.
 *
 * ## Sibling File Imports
 * In CCScript, files in the same directory implicitly share a namespace.
 * Symbols from sibling files are available without explicit imports.
 * The first time a directory is seen, all of its .ccs files are loaded
 * (disable with `loadSiblings: false` and call loadSiblingFiles() instead).
 *
 * ## Binding
 * Loading only parses. When a public load call finishes, every compilation group it
 * touched, plus groups that depend on them, is rebound in dependency order, so each
 * module's `binding` is current when loadModule()/reloadModule() resolves.
 *
 * @example
 * ```typescript
 * // LSP: When opening a document (its directory's siblings load automatically)
 * await program.loadModule(documentUri.fsPath);
 *
 * // LSP: When a document changes
 * await program.reloadModule(documentUri.fsPath);
 * // Its group and dependent groups have been rebound
 * ```
 */
export class Program {
    private readonly options: Required<ProgramOptions>;
    private readonly modules = new Map<string, Module>();
    private readonly modulesByName = new Map<string, Module>();
    private readonly groups = new Map<string, CompilationGroup>();  // Key: directory path
    private diagnostics: ImportDiagnostic[] = [];
    /** Groups with modules added or changed since they were last bound */
    private readonly dirtyGroups = new Set<CompilationGroup>();
    /** Module names each group referenced as `module.member` in its last binding */
    private readonly qualifiedReferences = new Map<CompilationGroup, Set<string>>();
    /** Import symbol tables keyed by dependency paths, for the current and previous bind pass */
    private importedSymbolsCache = new Map<string, { trees: SyntaxTree[]; table: SymbolTable }>();
    private previousImportedSymbolsCache = new Map<string, { trees: SyntaxTree[]; table: SymbolTable }>();
    /** Top-level declarations per parsed tree (collected once per parse) */
    private readonly declarationCache = new WeakMap<SyntaxTree, SymbolTable>();
    /** Loads that have started but not yet registered their module */
    private readonly inFlightLoads = new Map<string, Promise<Module | null>>();
    /** Resolves once the auto-included standard libraries have finished loading */
    private stdLibsLoaded: Promise<void> = Promise.resolve();

    constructor(options: ProgramOptions) {
        this.options = {
            ...options,
            libPaths: options.libPaths ?? [],
            includeStdLibs: options.includeStdLibs ?? true,
            loadSiblings: options.loadSiblings ?? true,
            stdLibPaths: options.stdLibPaths ?? {},
            log: options.log ?? (() => {}),
        };

        // Auto-load standard libraries if enabled
        if (this.options.includeStdLibs) {
            this.stdLibsLoaded = this.loadStandardLibraries().catch(err => {
                this.log(`Failed to load standard libraries: ${err}`);
            });
        }
    }

    /**
     * Load standard library files (std.ccs and stdarg.ccs)
     */
    private async loadStandardLibraries(): Promise<void> {
        const stdPaths = this.options.stdLibPaths;

        if (stdPaths.std) {
            await this.loadModule(stdPaths.std);
        }

        if (stdPaths.stdarg) {
            await this.loadModule(stdPaths.stdarg);
        }
    }

    /**
     * Load a module from a file path.
     * Recursively loads all imported modules (and, unless disabled, its directory's siblings),
     * then binds every affected compilation group before returning.
     * @param filePath Absolute path to the module file
     * @param reload If true, re-parse even if already loaded (for LSP file changes)
     * @returns The loaded module, or null if loading failed
     */
    async loadModule(filePath: string, reload = false): Promise<Module | null> {
        const module = await this.load(filePath, reload);
        this.bindDirtyGroups();
        return module;
    }

    /**
     * Load a module without binding. Binding is deferred to the outermost public call.
     */
    private load(filePath: string, reload: boolean): Promise<Module | null> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);

        if (!reload) {
            const loaded = this.modules.get(normalizedPath);
            if (loaded) {
                return Promise.resolve(loaded);
            }

            // Share an in-flight load (e.g. two documents importing the same file concurrently)
            const inFlight = this.inFlightLoads.get(normalizedPath);
            if (inFlight) {
                return inFlight;
            }
        }

        const promise = this.loadUncached(normalizedPath, reload);
        this.inFlightLoads.set(normalizedPath, promise);
        const clear = () => {
            if (this.inFlightLoads.get(normalizedPath) === promise) {
                this.inFlightLoads.delete(normalizedPath);
            }
        };
        promise.then(clear, clear);
        return promise;
    }

    private async loadUncached(normalizedPath: string, reload: boolean): Promise<Module | null> {
        this.log(`${reload ? 'Reloading' : 'Loading'} module: ${normalizedPath}`);

        // Drop import diagnostics from any previous load of this file
        this.diagnostics = this.diagnostics.filter(d => d.filePath !== normalizedPath);

        // Check if file exists
        if (!await this.options.fileSystem.exists(normalizedPath)) {
            this.addDiagnostic(normalizedPath, '', `Module not found: ${normalizedPath}`, DiagnosticSeverity.Error);
            return null;
        }

        // Read and parse the file
        let content: string;
        try {
            content = await this.options.fileSystem.readFile(normalizedPath);
        } catch (error) {
            this.addDiagnostic(normalizedPath, '', `Failed to read module: ${error}`, DiagnosticSeverity.Error);
            return null;
        }

        // Parse syntax only (semantic analysis happens per group in bindDirtyGroups)
        const tree = SyntaxTree.parse(content, normalizedPath);
        const name = this.getModuleName(normalizedPath);

        // Check for name collision
        const existingModule = this.modulesByName.get(name);
        if (existingModule && existingModule.filePath !== normalizedPath) {
            this.addDiagnostic(
                normalizedPath,
                '',
                `Module name collision: '${name}' already loaded from ${existingModule.filePath}`,
                DiagnosticSeverity.Error
            );
            return null;
        }

        // Create module (without dependencies or binding yet)
        const module: Module = {
            filePath: normalizedPath,
            name,
            tree,
            imports: this.extractImports(tree),
            dependencies: [],
            binding: undefined,
            group: undefined,
        };

        // Register module before processing imports, so import cycles terminate at the cache.
        // (Cycles are legal: the compiler loads each module once and includes it wherever imported.)
        this.modules.set(normalizedPath, module);
        this.modulesByName.set(name, module);

        // Add to compilation group
        const dir = this.options.fileSystem.dirname(normalizedPath);
        const isNewGroup = !this.groups.has(dir);
        const group = this.getOrCreateGroup(dir);
        const existingIndex = group.modules.findIndex(m => m.filePath === normalizedPath);
        if (existingIndex >= 0) {
            group.modules[existingIndex] = module;
        } else {
            group.modules.push(module);
        }
        (module as { group?: CompilationGroup }).group = group;

        // Rebind groups that refer to this module by name (`name.member`)
        for (const [referencingGroup, names] of this.qualifiedReferences) {
            if (names.has(name)) {
                this.dirtyGroups.add(referencingGroup);
            }
        }

        // Point importers of a reloaded module at the new instance
        if (reload) {
            for (const other of this.modules.values()) {
                const deps = other.dependencies as Module[];
                const index = deps.findIndex(d => d.filePath === normalizedPath);
                if (index >= 0) {
                    deps[index] = module;
                }
            }
        }

        // Process imports recursively
        await this.processImports(module);

        // Pull in the rest of the directory so sibling symbols resolve
        if (isNewGroup && this.options.loadSiblings) {
            await this.loadGroupSiblings(group);
        }

        // Mark after imports are processed, so a concurrent bind pass can't consume
        // the mark while this module's dependencies are still incomplete
        this.dirtyGroups.add(group);

        return module;
    }

    /**
     * Load multiple modules (e.g., all files passed on command line).
     * @param filePaths Array of absolute file paths
     * @returns Array of successfully loaded modules
     */
    async loadModules(filePaths: string[]): Promise<Module[]> {
        const modules: Module[] = [];

        for (const filePath of filePaths) {
            const module = await this.loadModule(filePath);
            if (module) {
                modules.push(module);
            }
        }

        return modules;
    }

    /**
     * Get a module by its absolute file path
     */
    getModule(filePath: string): Module | undefined {
        const normalized = this.options.fileSystem.normalize(filePath);
        return this.modules.get(normalized);
    }

    /**
     * Get a module by its name
     */
    getModuleByName(name: string): Module | undefined {
        return this.modulesByName.get(name);
    }

    /**
     * Get all loaded modules
     */
    getAllModules(): Module[] {
        return Array.from(this.modules.values());
    }

    /**
     * Get all import diagnostics
     */
    getDiagnostics(): readonly ImportDiagnostic[] {
        return this.diagnostics;
    }

    /**
     * Bind an entire compilation group using two-phase binding.
     * PHASE 1: Collect declarations from all modules in group (O(n))
     * PHASE 2: Bind each module against shared declarations + dependencies (O(n))
     */
    private bindGroup(group: CompilationGroup): void {
        this.log(`Binding group: ${group.directory} (${group.modules.length} modules)`);

        // PHASE 1: Collect declarations from all modules in group
        group.sharedDeclarations.clear();

        for (const module of group.modules) {
            group.sharedDeclarations.merge(this.getDeclarations(module));
        }

        // PHASE 2: Bind each module against shared declarations + dependencies
        const referencedModules = new Set<string>();
        this.qualifiedReferences.set(group, referencedModules);
        for (const module of group.modules) {
            const importedSymbols = this.getImportedSymbols(module);

            // Create binding context
            const context: BindingContext = {
                filePath: module.filePath,
                sharedSymbols: group.sharedDeclarations,
                importedSymbols,
                resolveModule: name => {
                    referencedModules.add(name);
                    const target = this.modulesByName.get(name);
                    return target && this.getDeclarations(target);
                },
            };

            // Bind this module
            const binding = Binder.bindReferences(module.tree.getRoot(), context);

            // Store binding result on module (cast to writable)
            (module as { binding?: BindingResult }).binding = binding;

            this.log(`  ${module.name}: ${binding.diagnostics.length} diagnostics`);
        }
    }

    /**
     * Bind every dirty group, plus the groups that (transitively) depend on them,
     * with dependencies bound before their dependents.
     */
    private bindDirtyGroups(): void {
        if (this.dirtyGroups.size === 0) {
            return;
        }

        const pending = new Set<CompilationGroup>();
        const addWithDependents = (group: CompilationGroup) => {
            if (pending.has(group)) return;
            pending.add(group);
            for (const dependent of group.dependents) {
                addWithDependents(dependent);
            }
        };
        for (const group of this.dirtyGroups) {
            this.updateGroupDependencies(group);
        }
        for (const group of this.dirtyGroups) {
            addWithDependents(group);
        }
        this.dirtyGroups.clear();

        // Keep only import tables that this pass uses
        this.previousImportedSymbolsCache = this.importedSymbolsCache;
        this.importedSymbolsCache = new Map();

        // Topological order: dependencies first
        const ordered: CompilationGroup[] = [];
        const visited = new Set<CompilationGroup>();
        const visit = (group: CompilationGroup) => {
            if (visited.has(group)) return;
            visited.add(group);
            for (const dep of group.dependsOn) {
                if (pending.has(dep)) visit(dep);
            }
            ordered.push(group);
        };
        for (const group of pending) {
            visit(group);
        }

        const bound = new Set<CompilationGroup>();
        const boundTooEarly: CompilationGroup[] = [];
        for (const group of ordered) {
            if ([...group.dependsOn].some(dep => pending.has(dep) && !bound.has(dep))) {
                boundTooEarly.push(group);
            }
            this.bindGroup(group);
            bound.add(group);
        }

        // Groups in a cycle were bound before one of their dependencies; bind them again
        for (const group of boundTooEarly) {
            this.bindGroup(group);
        }
    }

    /**
     * Symbols a module sees through its imports. Like the compiler's Module::Include, this is
     * only each imported module's own top-level declarations (imports aren't transitive), with
     * later imports taking priority (std libs are implicitly imported first).
     *
     * Tables are shared between modules with the same imports (e.g. a directory of files that all
     * import the same few modules) and kept only while some binding pass still uses them.
     */
    private getImportedSymbols(module: Module): SymbolTable {
        const key = module.dependencies.map(dep => dep.filePath).join('\n');
        const cached = this.importedSymbolsCache.get(key) ?? this.previousImportedSymbolsCache.get(key);
        if (cached && cached.trees.every((tree, i) => tree === module.dependencies[i].tree)) {
            this.importedSymbolsCache.set(key, cached);
            return cached.table;
        }

        const table = new SymbolTable();
        for (const dep of module.dependencies) {
            for (const symbol of this.getDeclarations(dep).getAllSymbols()) {
                if (symbol.kind !== SymbolKind.Module) {
                    table.add(symbol);
                }
            }
        }
        this.importedSymbolsCache.set(key, { trees: module.dependencies.map(dep => dep.tree), table });
        return table;
    }

    /**
     * Get a module's top-level declarations, collected once per parse.
     */
    private getDeclarations(module: Module): SymbolTable {
        let declarations = this.declarationCache.get(module.tree);
        if (!declarations) {
            declarations = Binder.collectDeclarations(module.tree.getRoot(), module.filePath);
            this.declarationCache.set(module.tree, declarations);
        }
        return declarations;
    }

    /**
     * Get or create a compilation group for a directory.
     */
    private getOrCreateGroup(directory: string): CompilationGroup {
        let group = this.groups.get(directory);
        if (!group) {
            group = {
                directory,
                modules: [],
                sharedDeclarations: new SymbolTable(),
                dependsOn: new Set(),
                dependents: new Set(),
            };
            this.groups.set(directory, group);
        }
        return group;
    }

    /**
     * Update dependency tracking between groups.
     */
    private updateGroupDependencies(group: CompilationGroup): void {
        // Clear old dependencies
        for (const dep of group.dependsOn) {
            dep.dependents.delete(group);
        }
        group.dependsOn.clear();

        // Add new dependencies
        for (const module of group.modules) {
            for (const dep of module.dependencies) {
                if (dep.group && dep.group !== group) {
                    group.dependsOn.add(dep.group);
                    dep.group.dependents.add(group);
                }
            }
        }
    }

    /**
     * Reload a module when its file changes (e.g., on edit in LSP).
     * Rebinds its compilation group and any groups that depend on it.
     * @param filePath Absolute path to the changed file
     * @returns The reloaded module, or null if reload failed
     */
    async reloadModule(filePath: string): Promise<Module | null> {
        return this.loadModule(filePath, true);
    }

    /**
     * Discover and load all .ccs files in the same directory as the given file.
     * Happens automatically on first load unless `loadSiblings` is false.
     * @param filePath Absolute path to a file whose siblings should be loaded
     * @returns Array of loaded sibling modules (excluding the file itself)
     */
    async loadSiblingFiles(filePath: string): Promise<Module[]> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        const group = this.getOrCreateGroup(this.options.fileSystem.dirname(normalizedPath));

        await this.loadGroupSiblings(group);
        this.bindDirtyGroups();

        return group.modules.filter(m => m.filePath !== normalizedPath);
    }

    /**
     * Load every .ccs file in a group's directory (without binding).
     */
    private async loadGroupSiblings(group: CompilationGroup): Promise<void> {
        const fs = this.options.fileSystem;
        const files = (await fs.readDirectory(group.directory))
            .map(f => fs.normalize(f))
            .filter(f => f.toLowerCase().endsWith('.ccs') && !this.modules.has(f));

        if (files.length === 0) {
            return;
        }

        this.log(`Loading ${files.length} sibling(s) in ${group.directory}`);
        for (const file of files) {
            await this.load(file, false);
        }
        this.dirtyGroups.add(group);
    }

    /**
     * Invalidate the semantic cache for a module by rebinding its compilation group.
     * This forces re-binding for the module and all siblings in the same directory.
     * @param filePath Path to the module to invalidate
     * @param invalidateDependents If true, also rebind groups that depend on this group
     */
    invalidateModule(filePath: string, invalidateDependents = false): void {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        const module = this.modules.get(normalizedPath);

        if (!module || !module.group) {
            return;
        }

        if (invalidateDependents) {
            this.dirtyGroups.add(module.group);
            this.bindDirtyGroups();
        } else {
            this.bindGroup(module.group);
        }
    }

    /**
     * Get modules in dependency order (dependencies before dependents).
     * Uses topological sort.
     */
    getModulesInDependencyOrder(): Module[] {
        const visited = new Set<Module>();
        const result: Module[] = [];

        const visit = (module: Module) => {
            if (visited.has(module)) return;
            visited.add(module);

            // Visit dependencies first
            for (const dep of module.dependencies) {
                visit(dep);
            }

            result.push(module);
        };

        // Visit all modules
        for (const module of this.modules.values()) {
            visit(module);
        }

        return result;
    }

    /**
     * Extract import paths from a syntax tree
     */
    private extractImports(tree: SyntaxTree): string[] {
        const imports: string[] = [];
        const root = tree.getRoot();

        for (const statement of root.getStatements()) {
            if (statement.kind === SyntaxKind.ImportStatement) {
                const importStmt = statement;
                const pathNode = importStmt.getChildren().find(c =>
                    c.kind === SyntaxKind.Identifier || c.kind === SyntaxKind.StringLiteral
                );

                if (pathNode && pathNode instanceof RedToken) {
                    let importPath = pathNode.text;

                    // If identifier, append .ccs extension
                    if (pathNode.kind === SyntaxKind.Identifier) {
                        importPath = importPath + '.ccs';
                    } else {
                        // String literal - remove quotes
                        importPath = importPath.slice(1, -1);
                    }

                    imports.push(importPath);
                }
            }
        }

        return imports;
    }

    /**
     * Process imports for a module, loading dependencies recursively
     */
    private async processImports(module: Module): Promise<void> {
        const importPaths = [...module.imports];

        // Auto-include standard libraries, except into the standard library directories
        // themselves (their files share a namespace, and waiting on them would deadlock)
        const fs = this.options.fileSystem;
        const stdLibPaths = [this.options.stdLibPaths.stdarg, this.options.stdLibPaths.std]
            .filter((p): p is string => !!p)
            .map(p => fs.normalize(p));
        const stdLibDirs = stdLibPaths.map(p => fs.dirname(p));
        if (this.options.includeStdLibs && !stdLibDirs.includes(fs.dirname(module.filePath))) {
            // They're loaded asynchronously from the constructor; wait so they aren't
            // still on the loading stack (which would be misreported as a circular import)
            await this.stdLibsLoaded;
            importPaths.unshift(...stdLibPaths);
        }

        const dependencies: Module[] = [];

        for (const importPath of importPaths) {
            const resolved = await this.resolveImport(importPath, module.filePath);

            if (!resolved) {
                this.addDiagnostic(
                    module.filePath,
                    importPath,
                    `Cannot resolve import: ${importPath}`,
                    DiagnosticSeverity.Error
                );
                continue;
            }

            // Load the imported module
            const importedModule = await this.load(resolved, false);
            if (importedModule) {
                dependencies.push(importedModule);
            }
        }

        // Update module's dependencies (cast to writable)
        (module as { dependencies: Module[] }).dependencies = dependencies;
    }

    /**
     * Resolve an import path to an absolute file path.
     * Search order (matching CCScript compiler):
     * 1. If absolute path, use as-is
     * 2. Same directory as importing file
     * 3. Project root directory
     * 4. Library directories
     */
    private async resolveImport(importPath: string, fromFile: string): Promise<string | null> {
        const fs = this.options.fileSystem;

        // If absolute, check if it exists
        if (fs.isAbsolute(importPath)) {
            const exists = await fs.exists(importPath);
            return exists ? importPath : null;
        }

        // 1. Same directory as importing file
        const fromDir = fs.dirname(fromFile);
        const sameDirPath = fs.join(fromDir, importPath);
        if (await fs.exists(sameDirPath)) {
            const resolved = fs.normalize(sameDirPath);
            return resolved;
        }

        // 2. Project root directory
        const rootPath = fs.join(this.options.rootPath, importPath);
        if (await fs.exists(rootPath)) {
            const resolved = fs.normalize(rootPath);
            return resolved;
        }

        // 3. Library directories
        for (const libPath of this.options.libPaths) {
            const libFilePath = fs.join(libPath, importPath);
            if (await fs.exists(libFilePath)) {
                const resolved = fs.normalize(libFilePath);
                return resolved;
            }
        }

        return null;
    }

    private log(message: string): void {
        this.options.log(`[CCScript:Program] ${message}`);
    }

    /**
     * Get module name from file path (filename without extension)
     */
    private getModuleName(filePath: string): string {
        const basename = this.options.fileSystem.basename(filePath, '.ccs');
        return basename;
    }

    /**
     * Add an import diagnostic
     */
    private addDiagnostic(
        filePath: string,
        importPath: string,
        message: string,
        severity: DiagnosticSeverity
    ): void {
        this.diagnostics.push({
            span: { start: 0, length: 0 },
            message,
            severity,
            filePath,
            importPath,
        });
    }
}
