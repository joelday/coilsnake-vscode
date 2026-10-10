/**
 * Keeps the Program in sync with open documents and the file system, and hands features an
 * analysis that is guaranteed to match the document text they were asked about.
 */

import {
    Connection,
    FileChangeType,
    FileEvent,
    InitializeParams,
    TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    AggregatedFileSystem,
    BindingResult,
    FileSystem,
    Module,
    NodeFileSystem,
    Program,
    SyntaxTree,
} from 'ccscript-core';
import { URI } from 'vscode-uri';
import { DocumentFileSystem } from './documentFileSystem';
import { ProjectCatalog, ProjectData } from './projectData';
import { computeDiagnostics } from './features/diagnostics';

export interface InlayHintSettings {
    /** Parameter names before literal arguments */
    parameterNames?: boolean;
    /** What literal values refer to: items, characters, constants with the same value... */
    values?: boolean;
    /** Which project table entries use a label's text */
    tableReferences?: boolean;
    /** The commands raw control codes in strings encode */
    controlCodes?: boolean;
}

export interface Settings {
    /** Directory containing std.ccs and stdarg.ccs */
    stdLibPath?: string;
    inlayHints?: InlayHintSettings;
}

export interface ServerOptions {
    /** File system for files that aren't open (defaults to the real one) */
    diskFileSystem?: FileSystem;
    /** Delay before publishing diagnostics after an edit, in milliseconds */
    validationDelay?: number;
}

/**
 * A module's analysis, consistent with the open document's current text.
 */
export interface Analysis {
    document: TextDocument;
    uri: string;
    filePath: string;
    module: Module;
    tree: SyntaxTree;
    binding: BindingResult;
}

export function uriToPath(uri: string): string {
    return URI.parse(uri).fsPath;
}

export function pathToUri(filePath: string): string {
    return URI.file(filePath).toString();
}

export class Workspace {
    program: Program;
    rootPath = '';
    settings: Settings = {};

    readonly fileSystem: FileSystem;
    /** CoilSnake project reference data (tables, build summary) */
    readonly projects: ProjectCatalog;
    private readonly diskFileSystem: FileSystem;
    private readonly validationDelay: number;
    private readonly pendingSyncs = new Map<string, { text: string; promise: Promise<void> }>();
    private readonly textDocuments = new WeakMap<SyntaxTree, TextDocument>();
    private validationTimer: ReturnType<typeof setTimeout> | undefined;
    private hasConfigurationCapability = false;
    private supportsInlayHintRefresh = false;
    private warnedAboutStdLib = false;

    constructor(
        readonly connection: Connection,
        readonly documents: TextDocuments<TextDocument>,
        options: ServerOptions = {}
    ) {
        this.diskFileSystem = options.diskFileSystem ?? new NodeFileSystem();
        this.fileSystem = new AggregatedFileSystem(new DocumentFileSystem(documents), this.diskFileSystem);
        this.validationDelay = options.validationDelay ?? 150;
        this.projects = new ProjectCatalog(this.diskFileSystem);
        this.program = this.createProgram();
    }

    initialize(params: InitializeParams): void {
        const root = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
        this.rootPath = root ? uriToPath(root) : '';
        this.settings = this.resolveSettings(params.initializationOptions as Settings | undefined);
        this.hasConfigurationCapability = !!params.capabilities.workspace?.configuration;
        this.supportsInlayHintRefresh = !!params.capabilities.workspace?.inlayHint?.refreshSupport;
        this.program = this.createProgram();
    }

    /**
     * Normalize settings, expanding `${workspaceFolder}` in paths.
     */
    private resolveSettings(settings: Settings | undefined): Settings {
        const stdLibPath = settings?.stdLibPath?.replace('${workspaceFolder}', this.rootPath) || undefined;
        return { ...settings, stdLibPath };
    }

    log(message: string): void {
        this.connection.console.log(`[CCScript] ${message}`);
    }

    private createProgram(): Program {
        const stdLibPath = this.settings.stdLibPath;
        return new Program({
            fileSystem: this.fileSystem,
            rootPath: this.rootPath,
            includeStdLibs: !!stdLibPath,
            stdLibPaths: stdLibPath ? {
                std: this.fileSystem.join(stdLibPath, 'std.ccs'),
                stdarg: this.fileSystem.join(stdLibPath, 'stdarg.ccs'),
            } : undefined,
        });
    }

    /**
     * The CoilSnake project a file belongs to, if any.
     */
    projectFor(filePath: string): Promise<ProjectData | undefined> {
        return this.projects.forFile(filePath);
    }

    /**
     * Whether a file is one of the configured standard library files.
     */
    isStandardLibrary(filePath: string): boolean {
        const stdLibPath = this.settings.stdLibPath;
        if (!stdLibPath) {
            return false;
        }
        const dir = this.fileSystem.normalize(stdLibPath);
        return this.fileSystem.dirname(this.fileSystem.normalize(filePath)) === dir;
    }

    /**
     * Get the analysis for an open document, waiting for any pending reload so that it
     * matches the document's current text. Returns undefined if the document isn't open,
     * or kept changing while being analyzed.
     */
    async getAnalysis(uri: string): Promise<Analysis | undefined> {
        const document = this.documents.get(uri);
        if (!document) {
            return undefined;
        }

        const filePath = this.fileSystem.normalize(uriToPath(uri));
        for (let attempt = 0; attempt < 3; attempt++) {
            const text = document.getText();
            const pending = this.pendingSyncs.get(filePath);
            if (pending) {
                await pending.promise;
            }
            let module = this.program.getModule(filePath);
            // (A module can be parsed but not yet bound while a load that found it, e.g. of its
            // directory, is still running; reloading it binds it.)
            if (!module || !module.binding || module.tree.source !== text) {
                await this.sync(filePath, text);
                module = this.program.getModule(filePath);
            }
            if (module?.binding && module.tree.source === document.getText()) {
                return { document, uri, filePath, module, tree: module.tree, binding: module.binding };
            }
        }
        return undefined;
    }

    /**
     * Reload a file, sharing the work with any reload already started for the same text.
     */
    private sync(filePath: string, text: string): Promise<void> {
        const pending = this.pendingSyncs.get(filePath);
        if (pending && pending.text === text) {
            return pending.promise;
        }

        const promise = this.program.reloadModule(filePath).then(
            () => undefined,
            error => this.log(`Failed to load ${filePath}: ${error}`)
        );
        const entry = { text, promise };
        this.pendingSyncs.set(filePath, entry);
        void promise.finally(() => {
            if (this.pendingSyncs.get(filePath) === entry) {
                this.pendingSyncs.delete(filePath);
            }
        });
        return promise;
    }

    /**
     * A text document for a module's analyzed source, for offset/position conversion.
     * (Open documents can be newer than a module that's still being reloaded.)
     */
    textDocumentFor(module: Module): TextDocument {
        let document = this.textDocuments.get(module.tree);
        if (!document) {
            document = TextDocument.create(pathToUri(module.filePath), 'ccscript', 0, module.tree.source);
            this.textDocuments.set(module.tree, document);
        }
        return document;
    }

    uriFor(module: Module): string {
        // Prefer the client's spelling of the URI for open documents
        const uri = pathToUri(module.filePath);
        return this.documents.keys().find(key => uriToPath(key) === module.filePath) ?? uri;
    }

    // ========== Events ==========

    documentChanged(document: TextDocument): void {
        void this.sync(this.fileSystem.normalize(uriToPath(document.uri)), document.getText());
        this.scheduleValidation();
    }

    async documentClosed(document: TextDocument): Promise<void> {
        this.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });

        // Fall back to the file on disk (dropping unsaved edits), or drop it if there isn't one
        const filePath = this.fileSystem.normalize(uriToPath(document.uri));
        if (await this.diskFileSystem.exists(filePath)) {
            await this.program.reloadModule(filePath);
        } else {
            await this.program.removeModule(filePath);
        }
        this.scheduleValidation();
    }

    async filesChanged(changes: FileEvent[]): Promise<void> {
        let created = false;
        for (const change of changes) {
            if (this.documents.get(change.uri)) {
                continue; // The open document is the source of truth
            }

            const filePath = this.fileSystem.normalize(uriToPath(change.uri));
            if (!filePath.toLowerCase().endsWith('.ccs')) {
                // A project table, build summary or Project.snake
                this.projects.fileChanged(filePath);
                this.refreshInlayHints();
                continue;
            }
            if (change.type === FileChangeType.Deleted) {
                await this.program.removeModule(filePath);
            } else if (this.program.getModule(filePath)) {
                await this.program.reloadModule(filePath);
            } else if (change.type === FileChangeType.Created) {
                created = true;
                const dir = this.fileSystem.dirname(filePath);
                if (this.program.getAllModules().some(m => this.fileSystem.dirname(m.filePath) === dir)) {
                    await this.program.loadModule(filePath);
                }
            }
        }

        // A new file may satisfy imports that couldn't be resolved before
        if (created) {
            const unresolved = new Set(this.program.getDiagnostics().map(d => d.filePath));
            for (const filePath of unresolved) {
                if (this.program.getModule(filePath)) {
                    await this.program.reloadModule(filePath);
                }
            }
        }

        this.scheduleValidation();
    }

    async configurationChanged(settings: unknown): Promise<void> {
        let section = (settings as { ccscript?: Settings } | undefined)?.ccscript;
        if (!section && this.hasConfigurationCapability) {
            section = await this.connection.workspace.getConfiguration('ccscript') as Settings | undefined;
        }
        if (!section) {
            return;
        }
        const resolved = this.resolveSettings(section);
        const stdLibChanged = resolved.stdLibPath !== this.settings.stdLibPath;
        this.settings = { ...this.settings, ...resolved };
        this.refreshInlayHints();
        if (!stdLibChanged) {
            return;
        }

        this.warnedAboutStdLib = false;
        this.program = this.createProgram();
        for (const document of this.documents.all()) {
            await this.program.loadModule(uriToPath(document.uri));
        }
        this.scheduleValidation();
    }

    inlayHintsEnabled(kind: keyof InlayHintSettings): boolean {
        return this.settings.inlayHints?.[kind] ?? true;
    }

    private refreshInlayHints(): void {
        if (this.supportsInlayHintRefresh) {
            void this.connection.languages.inlayHint.refresh().catch(() => undefined);
        }
    }

    // ========== Diagnostics ==========

    scheduleValidation(): void {
        if (this.validationTimer) {
            clearTimeout(this.validationTimer);
        }
        this.validationTimer = setTimeout(() => {
            this.validationTimer = undefined;
            void this.validateOpenDocuments();
        }, this.validationDelay);
    }

    /**
     * Report why a document couldn't be loaded (e.g. its module name collides with another's).
     * If it's just still changing, a later validation covers it.
     */
    private publishLoadFailure(document: TextDocument): void {
        const filePath = this.fileSystem.normalize(uriToPath(document.uri));
        const problems = this.program.getDiagnostics().filter(d => d.filePath === filePath && !d.importPath);
        if (problems.length > 0 && !this.program.getModule(filePath)) {
            this.connection.sendDiagnostics({
                uri: document.uri,
                version: document.version,
                diagnostics: problems.map(d => ({
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    severity: 1,
                    message: d.message,
                    source: 'ccscript',
                })),
            });
        }
    }

    private async validateOpenDocuments(): Promise<void> {
        for (const document of this.documents.all()) {
            const analysis = await this.getAnalysis(document.uri);
            if (!analysis) {
                this.publishLoadFailure(document);
                continue;
            }

            const version = document.version;
            const diagnostics = computeDiagnostics(this, analysis);
            if (document.version !== version || analysis.tree.source !== document.getText()) {
                continue;
            }
            this.connection.sendDiagnostics({ uri: document.uri, version, diagnostics });

            if (!this.settings.stdLibPath && !this.warnedAboutStdLib &&
                analysis.binding.diagnostics.some(d => d.message.startsWith('Undefined '))) {
                this.warnedAboutStdLib = true;
                void this.connection.window.showWarningMessage(
                    'CCScript: standard library commands (like `next` and `eob`) will be reported as ' +
                    'undefined until `ccscript.stdLibPath` is set to the folder containing std.ccs ' +
                    '(CoilSnake\'s assets/mobile-sprout/lib).'
                );
            }
        }
    }
}
