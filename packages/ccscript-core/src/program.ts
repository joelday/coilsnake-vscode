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
    /** Semantic analysis result (bound against the module's imports) */
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
     * so `module.member` references to them resolve (default: true)
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
 * ## Name resolution
 * Matches the CCScript compiler (ccscript_legacy, as used by CoilSnake builds):
 * - Unqualified names resolve to the module's own declarations, then the top-level
 *   declarations of the modules it imports (std.ccs/stdarg.ccs are imported implicitly).
 *   Imports aren't transitive, and files in the same directory don't share names.
 * - `module.member` resolves against any loaded module, imported or not.
 *
 * ## Sibling files
 * A CoilSnake build compiles every .ccs file in the project's ccscript directory, so any
 * of them can be referenced as `module.member`. To approximate that, the first time a
 * directory is seen all of its .ccs files are loaded (disable with `loadSiblings: false`
 * and call loadSiblingFiles() instead).
 *
 * ## Binding
 * Loading only parses. When a public load call finishes, every module it loaded or
 * changed is bound, along with modules that import or qualify-reference those modules,
 * so each module's `binding` is current when loadModule()/reloadModule() resolves.
 *
 * @example
 * ```typescript
 * // LSP: When opening a document (its directory's siblings load automatically)
 * await program.loadModule(documentUri.fsPath);
 *
 * // LSP: When a document changes
 * await program.reloadModule(documentUri.fsPath);
 * // It and the modules that depend on it have been rebound
 * ```
 */
export class Program {
    private readonly options: Required<ProgramOptions>;
    private readonly modules = new Map<string, Module>();
    private readonly modulesByName = new Map<string, Module>();
    private diagnostics: ImportDiagnostic[] = [];
    /** Directories whose sibling files have been loaded */
    private readonly discoveredDirectories = new Set<string>();
    /** Paths of modules loaded or changed since they were last bound */
    private readonly dirtyModules = new Set<string>();
    /** Module names each module (by path) referenced as `module.member` in its last binding */
    private readonly qualifiedReferences = new Map<string, Set<string>>();
    /** Import symbol tables keyed by dependency paths, for the current and previous bind pass */
    private importedSymbolsCache = new Map<string, { trees: SyntaxTree[]; table: SymbolTable }>();
    private previousImportedSymbolsCache = new Map<string, { trees: SyntaxTree[]; table: SymbolTable }>();
    /** Top-level declarations per parsed tree (collected once per parse) */
    private readonly declarationCache = new WeakMap<SyntaxTree, SymbolTable>();
    /** Loads that have started but not yet registered their module */
    private readonly inFlightLoads = new Map<string, Promise<Module | null>>();

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
            this.loadStandardLibraries().catch(err => {
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
        this.bindDirtyModules();
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

        // Reloads of a file run one after another, so an older read can't land last
        const previous = this.inFlightLoads.get(normalizedPath);
        const promise = previous
            ? previous.catch(() => null).then(() => this.loadUncached(normalizedPath, reload))
            : this.loadUncached(normalizedPath, reload);
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

        // Parse syntax only (semantic analysis happens in bindDirtyModules)
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
        };

        // Register module before processing imports, so import cycles terminate at the cache.
        // (Cycles are legal: the compiler loads each module once and includes it wherever imported.)
        this.modules.set(normalizedPath, module);
        this.modulesByName.set(name, module);

        // Rebind modules that refer to this module by name (`name.member`)
        for (const [referencingPath, names] of this.qualifiedReferences) {
            if (names.has(name)) {
                this.dirtyModules.add(referencingPath);
            }
        }

        // Point importers of a reloaded module at the new instance, and rebind them
        if (reload) {
            for (const other of this.modules.values()) {
                const deps = other.dependencies as Module[];
                const index = deps.findIndex(d => d.filePath === normalizedPath);
                if (index >= 0) {
                    deps[index] = module;
                    this.dirtyModules.add(other.filePath);
                }
            }
        }

        // Process imports recursively
        await this.processImports(module);

        // Pull in the rest of the directory so `sibling.member` references resolve
        if (this.options.loadSiblings) {
            await this.loadDirectory(this.options.fileSystem.dirname(normalizedPath));
        }

        // Mark after imports are processed, so a concurrent bind pass can't consume
        // the mark while this module's dependencies are still incomplete
        this.dirtyModules.add(normalizedPath);

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
     * Bind a module against its imports.
     */
    private bindModule(module: Module): void {
        const referencedModules = new Set<string>();
        this.qualifiedReferences.set(module.filePath, referencedModules);

        const context: BindingContext = {
            filePath: module.filePath,
            importedSymbols: this.getImportedSymbols(module),
            resolveModule: name => {
                referencedModules.add(name);
                const target = this.modulesByName.get(name);
                return target && this.getDeclarations(target);
            },
        };

        const binding = Binder.bindReferences(module.tree.getRoot(), context);
        (module as { binding?: BindingResult }).binding = binding;

        this.log(`Bound ${module.name}: ${binding.diagnostics.length} diagnostics`);
    }

    /**
     * Bind every module loaded or changed since the last pass. Imports and qualified names
     * resolve against modules' parsed declarations, not their bindings, so order doesn't matter.
     */
    private bindDirtyModules(): void {
        if (this.dirtyModules.size === 0) {
            return;
        }

        // Keep only import tables that this pass uses
        this.previousImportedSymbolsCache = this.importedSymbolsCache;
        this.importedSymbolsCache = new Map();

        const paths = [...this.dirtyModules];
        this.dirtyModules.clear();
        for (const path of paths) {
            const module = this.modules.get(path);
            if (module) {
                this.bindModule(module);
            }
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
     * Reload a module when its file changes (e.g., on edit in LSP).
     * Rebinds it and the modules that import or qualify-reference it.
     * @param filePath Absolute path to the changed file
     * @returns The reloaded module, or null if reload failed
     */
    async reloadModule(filePath: string): Promise<Module | null> {
        return this.loadModule(filePath, true);
    }

    /**
     * Remove a module (e.g. its file was deleted). Modules that imported it are reloaded,
     * so they report the now-unresolvable import.
     */
    async removeModule(filePath: string): Promise<void> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        const module = this.modules.get(normalizedPath);
        if (!module) {
            return;
        }

        this.modules.delete(normalizedPath);
        if (this.modulesByName.get(module.name) === module) {
            this.modulesByName.delete(module.name);
        }
        this.diagnostics = this.diagnostics.filter(d => d.filePath !== normalizedPath);
        this.qualifiedReferences.delete(normalizedPath);
        this.dirtyModules.delete(normalizedPath);

        for (const [referencingPath, names] of this.qualifiedReferences) {
            if (names.has(module.name)) {
                this.dirtyModules.add(referencingPath);
            }
        }

        const importers = this.getAllModules()
            .filter(m => m.dependencies.some(d => d.filePath === normalizedPath));
        for (const importer of importers) {
            await this.load(importer.filePath, true);
        }

        this.bindDirtyModules();
    }

    /**
     * Discover and load all .ccs files in the same directory as the given file.
     * Happens automatically on first load unless `loadSiblings` is false.
     * @param filePath Absolute path to a file whose siblings should be loaded
     * @returns Array of loaded sibling modules (excluding the file itself)
     */
    async loadSiblingFiles(filePath: string): Promise<Module[]> {
        const fs = this.options.fileSystem;
        const normalizedPath = fs.normalize(filePath);
        const dir = fs.dirname(normalizedPath);

        await this.loadDirectory(dir);
        this.bindDirtyModules();

        return this.getAllModules().filter(m => fs.dirname(m.filePath) === dir && m.filePath !== normalizedPath);
    }

    /**
     * Load every .ccs file in a directory, once (without binding).
     */
    private async loadDirectory(dir: string): Promise<void> {
        if (this.discoveredDirectories.has(dir)) {
            return;
        }
        this.discoveredDirectories.add(dir);

        const fs = this.options.fileSystem;
        const files = (await fs.readDirectory(dir))
            .map(f => fs.normalize(f))
            .filter(f => f.toLowerCase().endsWith('.ccs') && !this.modules.has(f));

        if (files.length > 0) {
            this.log(`Loading ${files.length} sibling(s) in ${dir}`);
        }
        for (const file of files) {
            await this.load(file, false);
        }
    }

    /**
     * Rebind a module.
     * @param filePath Path to the module to invalidate
     * @param invalidateDependents If true, also rebind modules that import it
     */
    invalidateModule(filePath: string, invalidateDependents = false): void {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        if (!this.modules.has(normalizedPath)) {
            return;
        }

        this.dirtyModules.add(normalizedPath);
        if (invalidateDependents) {
            for (const other of this.modules.values()) {
                if (other.dependencies.some(d => d.filePath === normalizedPath)) {
                    this.dirtyModules.add(other.filePath);
                }
            }
        }
        this.bindDirtyModules();
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

        // Like the compiler, implicitly import the standard libraries into every module
        // (ahead of explicit imports), except into themselves
        if (this.options.includeStdLibs) {
            const stdLibPaths = [this.options.stdLibPaths.stdarg, this.options.stdLibPaths.std]
                .filter((p): p is string => !!p)
                .map(p => this.options.fileSystem.normalize(p))
                .filter(p => p !== module.filePath);
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
