/**
 * FileSystem implementation that wraps LSP TextDocuments manager.
 * Provides read access to open documents in the editor.
 */

import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FileSystem } from 'ccscript-core';
import * as path from 'path';
import { URI } from 'vscode-uri';

/**
 * File system backed by LSP document manager.
 * Only provides access to currently open documents.
 * Should be used as primary layer in AggregatedFileSystem.
 */
export class DocumentFileSystem implements FileSystem {
    constructor(private documents: TextDocuments<TextDocument>) { }

    /**
     * Convert URI to file path
     */
    private uriToPath(uri: string): string {
        // If it's already a file path, return it
        if (!uri.startsWith('file://')) {
            return uri;
        }
        return URI.parse(uri).fsPath;
    }

    /**
     * Convert file path to URI
     */
    private pathToUri(filePath: string): string {
        // If it's already a URI, return it
        if (filePath.startsWith('file://')) {
            return filePath;
        }
        return URI.file(filePath).toString();
    }

    async readFile(filePath: string): Promise<string> {
        return this.readFileSync(filePath);
    }

    readFileSync(filePath: string): string {
        const uri = this.pathToUri(filePath);
        const doc = this.documents.get(uri);
        if (!doc) {
            throw new Error(`Document not open: ${filePath}`);
        }
        return doc.getText();
    }

    async exists(filePath: string): Promise<boolean> {
        return this.existsSync(filePath);
    }

    existsSync(filePath: string): boolean {
        const uri = this.pathToUri(filePath);
        return this.documents.get(uri) !== undefined;
    }

    async readDirectory(dirPath: string): Promise<string[]> {
        const dir = path.normalize(this.uriToPath(dirPath));
        return this.documents.keys()
            .map(uri => this.uriToPath(uri))
            .filter(filePath => path.dirname(filePath) === dir);
    }

    // Path operations delegate to Node.js path module
    resolve(...paths: string[]): string {
        return path.resolve(...paths);
    }

    dirname(filePath: string): string {
        // Convert URI to path if needed
        const fsPath = this.uriToPath(filePath);
        return path.dirname(fsPath);
    }

    join(...paths: string[]): string {
        return path.join(...paths);
    }

    basename(filePath: string, ext?: string): string {
        const fsPath = this.uriToPath(filePath);
        return path.basename(fsPath, ext);
    }

    normalize(filePath: string): string {
        const fsPath = this.uriToPath(filePath);
        return path.normalize(fsPath);
    }

    isAbsolute(filePath: string): boolean {
        const fsPath = this.uriToPath(filePath);
        return path.isAbsolute(fsPath);
    }

    relative(from: string, to: string): string {
        const fromPath = this.uriToPath(from);
        const toPath = this.uriToPath(to);
        return path.relative(fromPath, toPath);
    }
}
