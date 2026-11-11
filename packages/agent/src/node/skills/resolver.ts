import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { ParseError } from '../../errors';
import type { SkillResourceResolver } from '../../skills/schema';

/** Resolves resources from the local filesystem with path traversal protection. */
export function createFsResolver(rootDir: string): SkillResourceResolver {
    const root = resolve(rootDir);
    const rootWithSep = root.endsWith(sep) ? root : root + sep;

    return {
        async read(relativePath: string) {
            const fullPath = resolve(root, relativePath);
            if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
                throw new ParseError(`Access denied: path escapes skill directory (${relativePath})`);
            }
            return await readFile(fullPath);
        },
        async list() {
            const folders = ['references', 'assets', 'scripts'];
            const results: string[] = [];

            for (const folder of folders) {
                const folderPath = join(rootDir, folder);
                try {
                    const files = await readdir(folderPath, { recursive: true });
                    for (const f of files) {
                        const rel = join(folder, f);
                        const s = await stat(join(rootDir, rel));
                        if (s.isFile()) {
                            results.push(rel);
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
