/**
 * File system abstraction for CCScript compilation and language services.
 * Allows for different implementations (Node.js fs, in-memory, LSP-based).
 * 
 * This enables:
 * - Testing without real file system access
 * - Integration with LSP workspace file operations
 * - Cross-platform path handling
 * - Mocking for unit tests
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * Abstract file system interface.
 * All paths should be absolute.
 */
export interface FileSystem {
    /**
     * Read file content as text
     */
    readFile(filePath: string): Promise<string>;

    /**
     * Read file content synchronously
     */
    readFileSync(filePath: string): string;

    /**
     * Check if file exists
     */
    exists(filePath: string): Promise<boolean>;

    /**
     * Check if file exists synchronously
     */
    existsSync(filePath: string): boolean;

    /**
     * Resolve path relative to base path
     */
    resolve(...paths: string[]): string;

    /**
     * Get directory name from path
     */
    dirname(filePath: string): string;

    /**
     * Join path components
     */
    join(...paths: string[]): string;

    /**
     * Get base name from path
     */
    basename(filePath: string, ext?: string): string;

    /**
     * Normalize path separators for platform
     */
    normalize(filePath: string): string;

    /**
     * Check if path is absolute
     */
    isAbsolute(filePath: string): boolean;

    /**
     * Get relative path from `from` to `to`
     */
    relative(from: string, to: string): string;
}

/**
 * Node.js file system implementation using fs module
 */
export class NodeFileSystem implements FileSystem {
    async readFile(filePath: string): Promise<string> {
        return fs.promises.readFile(filePath, 'utf-8');
    }

    readFileSync(filePath: string): string {
        return fs.readFileSync(filePath, 'utf-8');
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    existsSync(filePath: string): boolean {
        try {
            fs.accessSync(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    resolve(...paths: string[]): string {
        return path.resolve(...paths);
    }

    dirname(filePath: string): string {
        return path.dirname(filePath);
    }

    join(...paths: string[]): string {
        return path.join(...paths);
    }

    basename(filePath: string, ext?: string): string {
        return path.basename(filePath, ext);
    }

    normalize(filePath: string): string {
        return path.normalize(filePath);
    }

    isAbsolute(filePath: string): boolean {
        return path.isAbsolute(filePath);
    }

    relative(from: string, to: string): string {
        return path.relative(from, to);
    }
}

/**
 * In-memory file system for testing.
 * Uses Map<string, string> to store file contents.
 */
export class MemoryFileSystem implements FileSystem {
    private files = new Map<string, string>();

    /**
     * Add a file to the memory file system
     */
    addFile(filePath: string, content: string): void {
        const normalized = this.normalize(filePath);
        this.files.set(normalized, content);
    }

    /**
     * Remove a file from the memory file system
     */
    removeFile(filePath: string): void {
        const normalized = this.normalize(filePath);
        this.files.delete(normalized);
    }

    /**
     * Clear all files
     */
    clear(): void {
        this.files.clear();
    }

    /**
     * Get all file paths
     */
    getFiles(): string[] {
        return Array.from(this.files.keys());
    }

    async readFile(filePath: string): Promise<string> {
        return this.readFileSync(filePath);
    }

    readFileSync(filePath: string): string {
        const normalized = this.normalize(filePath);
        const content = this.files.get(normalized);
        if (content === undefined) {
            throw new Error(`File not found: ${filePath}`);
        }
        return content;
    }

    async exists(filePath: string): Promise<boolean> {
        return this.existsSync(filePath);
    }

    existsSync(filePath: string): boolean {
        const normalized = this.normalize(filePath);
        return this.files.has(normalized);
    }

    resolve(...paths: string[]): string {
        // Simplified resolution for testing - just normalize
        if (paths.length === 0) return '/';
        if (paths.length === 1) return this.normalize(paths[0]);

        let result = paths[0];
        for (let i = 1; i < paths.length; i++) {
            if (this.isAbsolute(paths[i])) {
                result = paths[i];
            } else {
                result = this.join(result, paths[i]);
            }
        }
        return this.normalize(result);
    }

    dirname(filePath: string): string {
        const normalized = this.normalize(filePath);
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) return '.';
        if (lastSlash === 0) return '/';
        return normalized.substring(0, lastSlash);
    }

    join(...paths: string[]): string {
        if (paths.length === 0) return '.';

        const filtered = paths.filter(p => p && p !== '.');
        if (filtered.length === 0) return '.';

        return this.normalize(filtered.join('/'));
    }

    basename(filePath: string, ext?: string): string {
        const normalized = this.normalize(filePath);
        const lastSlash = normalized.lastIndexOf('/');
        const base = lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);

        if (ext && base.endsWith(ext)) {
            return base.substring(0, base.length - ext.length);
        }
        return base;
    }

    normalize(filePath: string): string {
        if (!filePath || filePath === '.') return '/';

        // Convert backslashes to forward slashes
        let normalized = filePath.replace(/\\/g, '/');

        // Remove duplicate slashes
        normalized = normalized.replace(/\/+/g, '/');

        // Handle leading slash
        if (!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }

        // Remove trailing slash unless it's root
        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.substring(0, normalized.length - 1);
        }

        return normalized;
    }

    isAbsolute(filePath: string): boolean {
        return filePath.startsWith('/') || filePath.startsWith('\\');
    }

    relative(from: string, to: string): string {
        const fromParts = this.normalize(from).split('/').filter(p => p);
        const toParts = this.normalize(to).split('/').filter(p => p);

        // Find common prefix
        let commonLength = 0;
        while (commonLength < fromParts.length &&
            commonLength < toParts.length &&
            fromParts[commonLength] === toParts[commonLength]) {
            commonLength++;
        }

        // Go up from 'from' to common ancestor
        const upSteps = fromParts.length - commonLength;
        const upPath = Array(upSteps).fill('..').join('/');

        // Go down to 'to' from common ancestor
        const downPath = toParts.slice(commonLength).join('/');

        if (upPath && downPath) {
            return upPath + '/' + downPath;
        } else if (upPath) {
            return upPath;
        } else if (downPath) {
            return downPath;
        } else {
            return '.';
        }
    }
}

/**
 * Default file system instance (uses Node.js fs)
 */
export const defaultFileSystem: FileSystem = new NodeFileSystem();
