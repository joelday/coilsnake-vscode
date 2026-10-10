/**
 * Runs the language server in-process over in-memory streams, with an in-memory file system,
 * and drives it through the LSP like an editor would.
 */

import { PassThrough } from 'stream';
import { createConnection } from 'vscode-languageserver/node';
import {
    Diagnostic,
    FileChangeType,
    Position,
    PublishDiagnosticsParams,
    Range,
} from 'vscode-languageserver-protocol';
import {
    createMessageConnection,
    MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { MemoryFileSystem } from 'ccscript-core';
import { URI } from 'vscode-uri';
import { startServer } from '../languageServer';

export const STD_LIB = '/lib';

/** A diagnostic's message text (LSP allows plain text or markup) */
export function messageText(diagnostic: Diagnostic): string {
    return typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value;
}

export function uri(path: string): string {
    return URI.file(path).toString();
}

/**
 * Split text containing a `|` cursor marker into the text and the cursor position.
 */
export function withCursor(textWithCursor: string): { text: string; position: Position } {
    const offset = textWithCursor.indexOf('|');
    if (offset < 0) {
        throw new Error('No | cursor marker in text');
    }
    const text = textWithCursor.slice(0, offset) + textWithCursor.slice(offset + 1);
    const before = text.slice(0, offset).split('\n');
    return { text, position: Position.create(before.length - 1, before[before.length - 1].length) };
}

export function positionOf(text: string, search: string, occurrence = 0, delta = 0): Position {
    let offset = -1;
    for (let i = 0; i <= occurrence; i++) {
        offset = text.indexOf(search, offset + 1);
        if (offset < 0) throw new Error(`'${search}' not found`);
    }
    const before = text.slice(0, offset + delta).split('\n');
    return Position.create(before.length - 1, before[before.length - 1].length);
}

export function textInRange(text: string, range: Range): string {
    const lines = text.split('\n');
    const offset = (p: Position) => lines.slice(0, p.line).reduce((sum, l) => sum + l.length + 1, 0) + p.character;
    return text.slice(offset(range.start), offset(range.end));
}

export interface TestClientOptions {
    files?: Record<string, string>;
    rootPath?: string;
    stdLib?: Record<string, string> | false;
    snippetSupport?: boolean;
    /** Delay file reads by this many milliseconds, like a real disk */
    readDelay?: number;
}

export class TestClient {
    readonly fs = new MemoryFileSystem();
    readonly connection: MessageConnection;
    readonly diagnostics = new Map<string, PublishDiagnosticsParams>();
    readonly messages: string[] = [];
    readonly logs: string[] = [];
    private readonly versions = new Map<string, number>();
    private readonly texts = new Map<string, string>();
    private diagnosticWaiters: (() => void)[] = [];

    private constructor(options: TestClientOptions) {
        for (const [path, content] of Object.entries(options.files ?? {})) {
            this.fs.addFile(path, content);
        }
        if (options.readDelay) {
            const readFile = this.fs.readFile.bind(this.fs);
            const delay = options.readDelay;
            this.fs.readFile = async (path: string) => {
                await new Promise(resolve => setTimeout(resolve, delay));
                return readFile(path);
            };
        }
        if (options.stdLib !== false) {
            const stdLib = options.stdLib ?? {
                'std.ccs': '// Waits for a button press\ncommand next "[03]"\ncommand eob "[02]"',
                'stdarg.ccs': 'command goto(target) "[0A {long target}]"',
            };
            for (const [name, content] of Object.entries(stdLib)) {
                this.fs.addFile(`${STD_LIB}/${name}`, content);
            }
        }

        const clientToServer = new PassThrough();
        const serverToClient = new PassThrough();
        startServer(
            createConnection(new StreamMessageReader(clientToServer), new StreamMessageWriter(serverToClient)),
            { diskFileSystem: this.fs, validationDelay: 0 }
        );

        this.connection = createMessageConnection(
            new StreamMessageReader(serverToClient),
            new StreamMessageWriter(clientToServer)
        );
        this.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
            this.diagnostics.set(params.uri, params);
            const waiters = this.diagnosticWaiters;
            this.diagnosticWaiters = [];
            waiters.forEach(resolve => resolve());
        });
        this.connection.onNotification('window/showMessage', (params: { message: string }) => {
            this.messages.push(params.message);
        });
        this.connection.onNotification('window/logMessage', (params: { message: string }) => {
            this.logs.push(params.message);
        });
        this.connection.onRequest('window/showMessageRequest', (params: { message: string }) => {
            this.messages.push(params.message);
            return null;
        });
        this.connection.listen();
    }

    static async start(options: TestClientOptions = {}): Promise<TestClient> {
        const client = new TestClient(options);
        await client.connection.sendRequest('initialize', {
            processId: null,
            rootUri: uri(options.rootPath ?? '/project'),
            capabilities: {
                textDocument: { completion: { completionItem: { snippetSupport: options.snippetSupport ?? true } } },
            },
            initializationOptions: options.stdLib === false ? {} : { stdLibPath: STD_LIB },
        });
        await client.connection.sendNotification('initialized', {});
        return client;
    }

    dispose(): void {
        this.connection.dispose();
    }

    text(path: string): string {
        return this.texts.get(path) ?? this.fs.readFileSync(path);
    }

    async open(path: string, text?: string): Promise<void> {
        const content = text ?? this.fs.readFileSync(path);
        this.versions.set(path, 1);
        this.texts.set(path, content);
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri: uri(path), languageId: 'ccscript', version: 1, text: content },
        });
    }

    /** Replace a document's whole text */
    async change(path: string, text: string): Promise<number> {
        const version = (this.versions.get(path) ?? 0) + 1;
        this.versions.set(path, version);
        this.texts.set(path, text);
        await this.connection.sendNotification('textDocument/didChange', {
            textDocument: { uri: uri(path), version },
            contentChanges: [{ text }],
        });
        return version;
    }

    /** Apply an incremental edit */
    async edit(path: string, range: Range, newText: string): Promise<number> {
        const version = (this.versions.get(path) ?? 0) + 1;
        this.versions.set(path, version);
        const old = this.text(path);
        const lines = old.split('\n');
        const offset = (p: Position) => lines.slice(0, p.line).reduce((sum, l) => sum + l.length + 1, 0) + p.character;
        this.texts.set(path, old.slice(0, offset(range.start)) + newText + old.slice(offset(range.end)));
        await this.connection.sendNotification('textDocument/didChange', {
            textDocument: { uri: uri(path), version },
            contentChanges: [{ range, text: newText }],
        });
        return version;
    }

    async close(path: string): Promise<void> {
        this.texts.delete(path);
        await this.connection.sendNotification('textDocument/didClose', { textDocument: { uri: uri(path) } });
    }

    async fileChanged(path: string, type: FileChangeType): Promise<void> {
        await this.connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: uri(path), type }],
        });
    }

    /**
     * Wait until diagnostics have been published for the document's current version
     * (or, with a predicate, until they satisfy it).
     */
    async waitForDiagnostics(path: string, predicate?: (diagnostics: Diagnostic[]) => boolean): Promise<Diagnostic[]> {
        const deadline = Date.now() + 5000;
        for (;;) {
            const published = this.diagnostics.get(uri(path));
            const current = published && (published.version === undefined || published.version === this.versions.get(path));
            if (published && current && (!predicate || predicate(published.diagnostics))) {
                return published.diagnostics;
            }
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for diagnostics for ${path}: ${JSON.stringify(published)}`);
            }
            await new Promise<void>(resolve => {
                this.diagnosticWaiters.push(resolve);
                setTimeout(resolve, 50);
            });
        }
    }

    request<R>(method: string, path: string, position?: Position, extra: object = {}): Promise<R> {
        return this.connection.sendRequest(method, {
            textDocument: { uri: uri(path) },
            ...(position ? { position } : {}),
            ...extra,
        }) as Promise<R>;
    }
}
