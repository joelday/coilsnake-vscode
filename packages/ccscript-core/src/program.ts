/**
 * Program/Project management for CCScript multi-file compilation.
 * Handles import resolution, dependency graph, and module loading.
 *
 * Architecture based on CCScript 1337 compiler's ProcessImports() in compiler.cpp:
 * - Start with explicitly loaded modules
 * - Process each module's imports recursively
 * - Search paths: (1) same dir as importing file, (2) project root, (3) lib directories
 * - Auto-include std.ccs and stdarg.ccs unless disabled
 * - Detect circular imports
 * - Load modules on-demand
 */

import { FileSystem } from './fileSystem';
import { SyntaxTree } from './syntaxTree';
import { RedToken } from './redNode';
import { SyntaxKind } from './syntax/syntaxKind';
import { Diagnostic, DiagnosticSeverity } from './syntax/types';
import { Binder, BindingResult, BindingContext } from './semantic/binder';
import { SymbolTable } from './semantic/symbol';
import { ScopeKind } from './semantic/scope';

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
 *
 * ### For Batch Compilation:
 * Load all files in order - each file will automatically see previously loaded siblings.
 *
 * ### For LSP/Language Server:
 * When a document is opened:
 * 1. Use workspace.findFiles() to discover all .ccs files in the same directory
 * 2. Call loadModule() for each file in the directory
 * 3. This ensures all siblings are loaded before semantic analysis
 *
 * When a file is saved/changed:
 * 1. Call reloadModule(path) - this rebinds its compilation group and dependent groups
 * 2. Each module's `binding` is updated immediately; no manual invalidation needed
 *
 * @example
 * ```typescript
 * // LSP: When opening a document
 * const directory = path.dirname(documentUri);
 * const siblingFiles = await workspace.findFiles(`${directory}/*.ccs`);
 * for (const file of siblingFiles) {
 *   await program.loadModule(file.fsPath);
 * }
 *
 * // LSP: When a document is saved
 * await program.reloadModule(documentUri.fsPath);
 * // All siblings and dependent groups have been rebound
 * ```
 */
export class Program {
    private readonly options: Required<ProgramOptions>;
    private readonly modules = new Map<string, Module>();
    private readonly modulesByName = new Map<string, Module>();
    private readonly groups = new Map<string, CompilationGroup>();  // Key: directory path
    private diagnostics: ImportDiagnostic[] = [];
    /** Resolves once the auto-included standard libraries have finished loading */
    private stdLibsLoaded: Promise<void> = Promise.resolve();

    constructor(options: ProgramOptions) {
        this.options = {
            ...options,
            libPaths: options.libPaths ?? [],
            includeStdLibs: options.includeStdLibs ?? true,
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
     * Recursively loads all imported modules.
     * Uses compilation groups for directory-based namespace sharing.
     * @param filePath Absolute path to the module file
     * @param reload If true, re-parse even if already loaded (for LSP file changes)
     * @returns The loaded module, or null if loading failed
     */
    async loadModule(filePath: string, reload = false): Promise<Module | null> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);

        this.log(`${reload ? 'Reloading' : 'Loading'} module: ${normalizedPath}`);

        // Check if already loaded (unless reload requested)
        if (this.modules.has(normalizedPath) && !reload) {
            return this.modules.get(normalizedPath)!;
        }

        // Add to loading stack for cycle detection
        this.loadingStack.add(normalizedPath);

        // Drop import diagnostics from any previous load of this file
        this.diagnostics = this.diagnostics.filter(d => d.filePath !== normalizedPath);

        try {
            // Check if file exists
            if (!await this.options.fileSystem.exists(normalizedPath)) {
                this.addDiagnostic(normalizedPath, '', `Module not found: ${filePath}`, DiagnosticSeverity.Error);
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

            // Parse syntax only (no semantic analysis yet)
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

            // Extract import statements
            const imports = this.extractImports(tree);

            // Create module (without dependencies or binding yet)
            const module: Module = {
                filePath: normalizedPath,
                name,
                tree,
                imports,
                dependencies: [],
                binding: undefined,
                group: undefined,
            };

            // Register module
            this.modules.set(normalizedPath, module);
            this.modulesByName.set(name, module);

            // Add to compilation group
            const dir = this.options.fileSystem.dirname(normalizedPath);
            const group = this.getOrCreateGroup(dir);
            const existingIndex = group.modules.findIndex(m => m.filePath === normalizedPath);
            if (existingIndex >= 0) {
                group.modules[existingIndex] = module;
            } else {
                group.modules.push(module);
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
            (module as { group?: CompilationGroup }).group = group;

            // Process imports recursively (loads dependencies from OTHER directories)
            await this.processImports(module);

            // Update group dependencies
            this.updateGroupDependencies(group);

            // If this was a reload, rebind the entire group and dependents
            if (reload) {
                this.rebindGroupAndDependents(group);
            } else {
                // Try to bind the group if all dependencies are ready
                this.bindGroupIfReady(group);
            }

            return module;
        } finally {
            // Remove from loading stack when done
            this.loadingStack.delete(normalizedPath);
        }
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
            const declarations = Binder.collectDeclarations(module.tree.getRoot(), module.filePath);

            // Merge into shared table
            group.sharedDeclarations.merge(declarations);
        }

        // PHASE 2: Bind each module against shared declarations + dependencies
        for (const module of group.modules) {
            // Get symbols from explicit dependencies (other directories)
            const importedSymbols = new SymbolTable();
            for (const dep of module.dependencies) {
                if (dep.binding) {
                    // Import only global-scope symbols from dependencies
                    for (const symbol of dep.binding.symbols.getAllSymbols()) {
                        const scope = dep.binding.scopes.getScope(symbol.scopeId);
                        if (scope?.kind === ScopeKind.Global) {
                            importedSymbols.add(symbol);
                        }
                    }
                }
            }

            // Create binding context
            const context: BindingContext = {
                filePath: module.filePath,
                sharedSymbols: group.sharedDeclarations,
                importedSymbols
            };

            // Bind this module
            const binding = Binder.bindReferences(module.tree.getRoot(), context);

            // Store binding result on module (cast to writable)
            (module as { binding?: BindingResult }).binding = binding;

            this.log(`  ${module.name}: ${binding.symbols.getAllSymbols().length} total symbols, ${binding.diagnostics.length} diagnostics`);
        }
    }

    /**
     * Check if all dependencies for a group are ready, and bind if so.
     */
    private bindGroupIfReady(group: CompilationGroup): void {
        // Check if all modules in group have their dependencies loaded and bound
        for (const module of group.modules) {
            for (const dep of module.dependencies) {
                if (!dep.binding) {
                    this.log(`Group not ready: ${module.name} depends on unbound ${dep.name}`);
                    return;  // Not ready yet
                }
            }
        }

        // All dependencies ready - bind the group
        this.bindGroup(group);
    }

    /**
     * Rebind a group and all groups that depend on it.
     */
    private rebindGroupAndDependents(group: CompilationGroup): void {
        this.log(`Rebinding group and dependents: ${group.directory}`);

        // Rebind this group
        this.bindGroup(group);

        // Find and rebind dependent groups
        for (const dependent of group.dependents) {
            this.log(`  Rebinding dependent group: ${dependent.directory}`);
            this.bindGroup(dependent);
        }
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
     * This is useful for LSP contexts where files may be opened in any order.
     * @param filePath Absolute path to a file whose siblings should be loaded
     * @returns Array of loaded sibling modules (excluding the file itself)
     */
    async loadSiblingFiles(filePath: string): Promise<Module[]> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        const dir = this.options.fileSystem.dirname(normalizedPath);

        // TODO: Add fileSystem.readdir() method to list files in directory
        // For now, this is a placeholder that documents the intended behavior
        // The LSP can call loadModule() for each .ccs file it discovers via workspace.findFiles()

        const siblings: Module[] = [];
        for (const module of this.modules.values()) {
            const moduleDir = this.options.fileSystem.dirname(module.filePath);
            if (moduleDir === dir && module.filePath !== normalizedPath) {
                siblings.push(module);
            }
        }

        return siblings;
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
            this.rebindGroupAndDependents(module.group);
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

        // Auto-include standard libraries (except into the standard libraries themselves)
        const stdLibPaths = [this.options.stdLibPaths.stdarg, this.options.stdLibPaths.std]
            .filter((p): p is string => !!p)
            .map(p => this.options.fileSystem.normalize(p));
        if (this.options.includeStdLibs && !stdLibPaths.includes(module.filePath)) {
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

            // Check for circular import
            if (this.hasCircularDependency(module.filePath, resolved)) {
                this.addDiagnostic(
                    module.filePath,
                    importPath,
                    `Circular import detected: ${importPath}`,
                    DiagnosticSeverity.Error
                );
                continue;
            }

            // Load the imported module
            const importedModule = await this.loadModule(resolved);
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

    // Track modules currently being loaded (for cycle detection)
    private readonly loadingStack = new Set<string>();

    /**
     * Check if loading targetPath from currentPath would create a circular dependency
     */
    private hasCircularDependency(currentPath: string, targetPath: string): boolean {
        const normalized = this.options.fileSystem.normalize(targetPath);
        const current = this.options.fileSystem.normalize(currentPath);

        // Direct self-import
        if (normalized === current) {
            return true;
        }

        // Check if target is currently being loaded (on the loading stack)
        // This indicates a circular dependency
        return this.loadingStack.has(normalized);
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
