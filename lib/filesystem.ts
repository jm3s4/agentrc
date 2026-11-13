import { ParseError } from './errors.ts';

/** Read-only virtual filesystem used by `Agent.load` and `Skill.load`. */
export interface FileSystem {
    read(path: string): Promise<Uint8Array | string>;
    list(prefix?: string): Promise<readonly string[]>;
}

/** Normalizes a relative POSIX path and rejects absolute paths or `..` traversal. */
export function normalizePath(rawPath: string, allowEmpty = false): string {
    if (!rawPath) {
        if (allowEmpty) {
            return '';
        }
        throw new ParseError('Security violation: File path cannot be empty');
    }

    if (/^([\\/]|[a-zA-Z]:)/.test(rawPath)) {
        throw new ParseError(`Security violation: Absolute paths are not allowed (${rawPath})`);
    }

    const segments = rawPath
        .replaceAll('\\', '/')
        .split('/')
        .filter((segment) => segment.length > 0 && segment !== '.');

    if (segments.includes('..')) {
        throw new ParseError(`Security violation: Path traversal is not allowed (${rawPath})`);
    }

    if (segments.length === 0 && !allowEmpty) {
        throw new ParseError(`Security violation: Invalid file path (${rawPath})`);
    }

    return segments.join('/');
}

/** Scopes any `FileSystem` to a relative subdirectory prefix. */
export function scopeFileSystem(fs: FileSystem, prefix: string): FileSystem {
    const base = normalizePath(prefix, true);
    if (!base) {
        return fs;
    }

    const baseSlash = `${base}/`;

    return {
        read(relativePath: string) {
            const safePath = normalizePath(relativePath);
            return fs.read(`${baseSlash}${safePath}`);
        },
        async list(subPrefix = '') {
            const safeSub = normalizePath(subPrefix, true);
            const targetPrefix = safeSub ? `${baseSlash}${safeSub}` : base;
            const entries = await fs.list(targetPrefix);
            return entries.filter((entry) => entry.startsWith(baseSlash)).map((entry) => entry.slice(baseSlash.length));
        },
    };
}

/** In-memory `FileSystem` backed by a `Map` or plain key-value record. */
export class MemoryFileSystem implements FileSystem {
    readonly #files = new Map<string, Uint8Array | string>();

    constructor(files: ReadonlyMap<string, Uint8Array | string> | Readonly<Record<string, Uint8Array | string>>) {
        const entries = files instanceof Map ? files.entries() : Object.entries(files);
        for (const [key, value] of entries) {
            this.#files.set(normalizePath(key), value);
        }
    }

    async read(relativePath: string): Promise<Uint8Array | string> {
        const key = normalizePath(relativePath);
        const content = this.#files.get(key);
        if (content === undefined) {
            throw new ParseError(`File not found: ${key}`);
        }
        return content;
    }

    async list(prefix = ''): Promise<readonly string[]> {
        const safePrefix = normalizePath(prefix, true);
        const prefixSlash = safePrefix ? `${safePrefix}/` : '';
        const paths: string[] = [];

        for (const key of this.#files.keys()) {
            if (!prefixSlash || key.startsWith(prefixSlash)) {
                paths.push(key);
            }
        }

        return paths.toSorted();
    }
}
