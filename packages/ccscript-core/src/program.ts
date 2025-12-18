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
 * 1. Call reloadModule(path) - this automatically invalidates all siblings
 * 2. Next semantic query on any sibling will re-bind with updated symbols
 * 3. No manual invalidation needed - happens automatically!
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
 * // All siblings are automatically invalidated and will re-bind on next use
 * ```
 */
export class Program {
    private readonly options: Required<ProgramOptions>;
    private readonly modules = new Map<string, Module>();
    private readonly modulesByName = new Map<string, Module>();
    private readonly diagnostics: ImportDiagnostic[] = [];

    constructor(options: ProgramOptions) {
        this.options = {
            ...options,
            libPaths: options.libPaths ?? [],
            includeStdLibs: options.includeStdLibs ?? true,
            stdLibPaths: options.stdLibPaths ?? {},
        };

        // Auto-load standard libraries if enabled
        if (this.options.includeStdLibs) {
            this.loadStandardLibraries().catch(err => {
                console.error('[CCScript:Program] Failed to load standard libraries:', err);
            });
        }
    }

    /**
     * Load standard library files (std.ccs and stdarg.ccs)
     */
    private async loadStandardLibraries(): Promise<void> {
        const stdPaths = this.options.stdLibPaths;

        if (stdPaths.std) {
            console.log(`[CCScript:Program] Loading std.ccs from: ${stdPaths.std}`);
            await this.loadModule(stdPaths.std);
        }

        if (stdPaths.stdarg) {
            console.log(`[CCScript:Program] Loading stdarg.ccs from: ${stdPaths.stdarg}`);
            await this.loadModule(stdPaths.stdarg);
        }
    }

    /**
     * Load a module from a file path.
     * Recursively loads all imported modules.
     * @param filePath Absolute path to the module file
     * @param reload If true, re-parse even if already loaded (for LSP file changes)
     * @returns The loaded module, or null if loading failed
     */
    async loadModule(filePath: string, reload = false): Promise<Module | null> {
        const normalizedPath = this.options.fileSystem.normalize(filePath);

        console.log(`[CCScript:Program] ${reload ? 'Reloading' : 'Loading'} module: ${normalizedPath}`);

        // Check if already loaded (unless reload requested)
        if (this.modules.has(normalizedPath) && !reload) {
            console.log('[CCScript:Program] Module already loaded, returning cached');
            return this.modules.get(normalizedPath)!;
        }

        // Add to loading stack for cycle detection
        this.loadingStack.add(normalizedPath);

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

            // Create a module resolver that can access already-loaded modules
            // Note: Files in the same directory are implicitly imported in CCScript
            const moduleResolver = (moduleName: string) => {
                return this.getModuleByName(moduleName);
            };

            // Get sibling modules (same directory) for implicit imports
            const siblingModules = this.getSiblingModules(normalizedPath);

            const tree = SyntaxTree.parse(content, normalizedPath, moduleResolver, siblingModules);
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

            // Create module (without dependencies yet)
            const module: Module = {
                filePath: normalizedPath,
                name,
                tree,
                imports,
                dependencies: [],
            };

            // Register module before processing imports (for cycle detection)
            this.modules.set(normalizedPath, module);
            this.modulesByName.set(name, module);

            // Process imports recursively
            await this.processImports(module);

            // If this was a reload, invalidate all sibling modules
            // so they pick up any symbol changes on next semantic query
            if (reload) {
                const dir = this.options.fileSystem.dirname(normalizedPath);
                for (const sibling of this.modules.values()) {
                    if (sibling === module) continue;
                    const siblingDir = this.options.fileSystem.dirname(sibling.filePath);
                    if (siblingDir === dir) {
                        sibling.tree.invalidateBinding();
                    }
                }
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
     * Reload a module when its file changes (e.g., on save in LSP).
     * Automatically invalidates all sibling modules to pick up symbol changes.
     * @param filePath Absolute path to the changed file
     * @returns The reloaded module, or null if reload failed
     */
    async reloadModule(filePath: string): Promise<Module | null> {
        console.log('[CCScript:Program] ═══ reloadModule called ═══');
        const result = await this.loadModule(filePath, true);
        console.log('[CCScript:Program] ═══ reloadModule finished ═══');
        return result;
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
     * Invalidate the semantic cache for a module and optionally its siblings.
     * This forces re-binding on next semantic query, useful when sibling files change.
     * @param filePath Path to the module to invalidate
     * @param invalidateSiblings If true, also invalidate all modules in same directory
     */
    invalidateModule(filePath: string, invalidateSiblings = false): void {
        const normalizedPath = this.options.fileSystem.normalize(filePath);
        const module = this.modules.get(normalizedPath);

        if (!module) {
            return;
        }

        module.tree.invalidateBinding();

        if (invalidateSiblings) {
            const dir = this.options.fileSystem.dirname(normalizedPath);
            for (const sibling of this.modules.values()) {
                const siblingDir = this.options.fileSystem.dirname(sibling.filePath);
                if (siblingDir === dir && sibling.filePath !== normalizedPath) {
                    sibling.tree.invalidateBinding();
                }
            }
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

        // Auto-include standard libraries
        if (this.options.includeStdLibs) {
            if (this.options.stdLibPaths.std) {
                importPaths.unshift(this.options.stdLibPaths.std);
            }
            if (this.options.stdLibPaths.stdarg) {
                importPaths.unshift(this.options.stdLibPaths.stdarg);
            }
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
            return await fs.exists(importPath) ? importPath : null;
        }

        // 1. Same directory as importing file
        const fromDir = fs.dirname(fromFile);
        const sameDirPath = fs.join(fromDir, importPath);
        if (await fs.exists(sameDirPath)) {
            return fs.normalize(sameDirPath);
        }

        // 2. Project root directory
        const rootPath = fs.join(this.options.rootPath, importPath);
        if (await fs.exists(rootPath)) {
            return fs.normalize(rootPath);
        }

        // 3. Library directories
        for (const libPath of this.options.libPaths) {
            const libFilePath = fs.join(libPath, importPath);
            if (await fs.exists(libFilePath)) {
                return fs.normalize(libFilePath);
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

    /**
     * Get module name from file path (filename without extension)
     */
    private getModuleName(filePath: string): string {
        const basename = this.options.fileSystem.basename(filePath, '.ccs');
        return basename;
    }

    /**
     * Get all modules in the same directory as the given file path,
     * plus standard library modules which are available to all files.
     * These are implicitly imported in CCScript.
     */
    private getSiblingModules(filePath: string): Module[] {
        const dir = this.options.fileSystem.dirname(filePath);
        const siblings: Module[] = [];

        console.log(`[CCScript:Program] Looking for siblings of ${filePath}`);
        console.log(`[CCScript:Program] Directory: ${dir}`);
        console.log(`[CCScript:Program] Total loaded modules: ${this.modules.size}`);

        // Determine stdlib paths (if configured)
        const stdLibPaths = new Set<string>();
        if (this.options.includeStdLibs && this.options.stdLibPaths) {
            if (this.options.stdLibPaths.std) {
                stdLibPaths.add(this.options.fileSystem.normalize(this.options.stdLibPaths.std));
            }
            if (this.options.stdLibPaths.stdarg) {
                stdLibPaths.add(this.options.fileSystem.normalize(this.options.stdLibPaths.stdarg));
            }
        }

        for (const module of this.modules.values()) {
            // Skip self
            if (module.filePath === filePath) {
                continue;
            }

            // Check if this is a stdlib module (always included as sibling)
            const normalizedPath = this.options.fileSystem.normalize(module.filePath);
            if (stdLibPaths.has(normalizedPath)) {
                console.log(`[CCScript:Program]   ✓ Standard library: ${module.name}`);
                siblings.push(module);
                continue;
            }

            // Check if in same directory
            const moduleDir = this.options.fileSystem.dirname(module.filePath);
            if (moduleDir === dir) {
                console.log(`[CCScript:Program]   ✓ Found sibling: ${module.name} (${module.filePath})`);
                siblings.push(module);
            } else {
                console.log(`[CCScript:Program]   ✗ Different dir: ${module.name} (${moduleDir})`);
            }
        }

        console.log(`[CCScript:Program] Total siblings found: ${siblings.length}`);
        return siblings;
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
