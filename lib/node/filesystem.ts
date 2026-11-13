import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { ParseError } from '../errors.ts';
import { type FileSystem, normalizePath } from '../filesystem.ts';

/**
 * Local disk implementation of `FileSystem` with lexical and symlink traversal protection.
 */
export class NodeFileSystem implements FileSystem {
    readonly rootDir: string;

    readonly #root: string;
    readonly #rootWithSep: string;
    #realRootPromise: Promise<string> | undefined;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.#root = resolve(rootDir);
        this.#rootWithSep = this.#root.endsWith(sep) ? this.#root : this.#root + sep;
    }

    async #getRealRoot(): Promise<string> {
        this.#realRootPromise ??= realpath(this.#root).catch((error) => {
            throw new ParseError(`Root directory not found: ${this.rootDir}`, error);
        });
        return await this.#realRootPromise;
    }

    async read(relativePath: string): Promise<Uint8Array> {
        const safePath = normalizePath(relativePath);
        const fullPath = resolve(this.#root, safePath);
        if (!fullPath.startsWith(this.#rootWithSep)) {
            throw new ParseError(`Access denied: path escapes root directory (${relativePath})`);
        }

        const realRoot = await this.#getRealRoot();
        const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

        let realTarget: string;
        try {
            realTarget = await realpath(fullPath);
        } catch (error) {
            throw new ParseError(`File not found: ${safePath}`, error);
        }

        if (!realTarget.startsWith(realRootWithSep)) {
            throw new ParseError(`Access denied: path escapes root directory (${relativePath})`);
        }

        try {
            return await readFile(realTarget);
        } catch (error) {
            throw new ParseError(`Failed to read file: ${safePath}`, error);
        }
    }

    async list(prefix = ''): Promise<readonly string[]> {
        const safePrefix = normalizePath(prefix, true);
        const targetDir = safePrefix ? resolve(this.#root, safePrefix) : this.#root;
        if (targetDir !== this.#root && !targetDir.startsWith(this.#rootWithSep)) {
            throw new ParseError(`Access denied: path escapes root directory (${prefix})`);
        }

        let realRoot: string;
        try {
            realRoot = await this.#getRealRoot();
        } catch {
            return [];
        }

        const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

        let realTargetDir: string;
        try {
            realTargetDir = await realpath(targetDir);
        } catch {
            return [];
        }

        if (realTargetDir !== realRoot && !realTargetDir.startsWith(realRootWithSep)) {
            throw new ParseError(`Access denied: path escapes root directory (${prefix})`);
        }

        try {
            const entries = await readdir(realTargetDir, { recursive: true, withFileTypes: true });
            const results: string[] = [];

            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const rel = relative(realRoot, join(entry.parentPath, entry.name));
                results.push(sep === '/' ? rel : rel.replaceAll(sep, '/'));
            }

            return results.toSorted();
        } catch {
            return [];
        }
    }
}
