import { ParseError } from '../errors';
import type { SkillResourceResolver } from './schema';

/** Resolves resources from an in-memory virtual file map (e.g. OCI bundles). */
export function createMemoryResolver(
    files: ReadonlyMap<string, Uint8Array | string>,
    prefix = '',
): SkillResourceResolver {
    const p = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
    return {
        async read(relativePath: string) {
            const target = `${p}${relativePath}`;
            const file = files.get(target);
            if (!file) {
                throw new ParseError(`Virtual resource not found: ${target}`);
            }
            return file;
        },
        async list() {
            const results: string[] = [];
            for (const [key] of files) {
                if (!key.startsWith(p)) {
                    continue;
                }
                const rel = key.slice(p.length);
                if (rel && rel !== 'SKILL.md') {
                    results.push(rel);
                }
            }
            return results;
        },
    };
}
