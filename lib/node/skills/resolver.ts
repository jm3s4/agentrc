import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { ParseError } from '../../errors.ts';
import type { SkillResourceResolver } from '../../skills/schema.ts';

/** Resolves resources from the local filesystem with path traversal protection. */
export function createFsResolver(rootDir: string): SkillResourceResolver {
    const root = resolve(rootDir);
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    let realRootPromise: Promise<string> | undefined;

    return {
        async read(relativePath: string) {
            const fullPath = resolve(root, relativePath);
            if (!fullPath.startsWith(rootWithSep)) {
                throw new ParseError(`Access denied: path escapes skill directory (${relativePath})`);
            }

            realRootPromise ??= realpath(root);
            const realRoot = await realRootPromise;
            const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

            let realTarget: string | undefined;
            try {
                realTarget = await realpath(fullPath);
            } catch {
                // Missing file or dangling symlink; let readFile report ENOENT
            }
            if (realTarget && !realTarget.startsWith(realRootWithSep)) {
                throw new ParseError(`Access denied: path escapes skill directory (${relativePath})`);
            }

            return await readFile(fullPath);
        },
        async list() {
            const folders = ['references', 'assets', 'scripts'];
            const results: string[] = [];

            for (const folder of folders) {
                const folderPath = join(root, folder);
                try {
                    const entries = await readdir(folderPath, { recursive: true, withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isFile()) {
                            const rel = relative(root, join(entry.parentPath, entry.name));
                            results.push(sep === '/' ? rel : rel.replaceAll(sep, '/'));
                        }
                    }
                } catch {
                    // Optional folder; ignore if missing
                }
            }
            return results;
        },
    };
}
