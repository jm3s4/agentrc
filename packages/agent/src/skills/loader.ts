import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ParseError } from '../errors';
import { parseSkill } from './parser';
import type { Skill, SkillResourceResolver, SkillSummary } from './schema';
import { createSkill } from './skill';

/** Resolves resources from the local filesystem with path traversal protection. */
export function createFsResolver(rootDir: string): SkillResourceResolver {
    return {
        async read(relativePath: string) {
            const fullPath = resolve(rootDir, relativePath);
            if (!fullPath.startsWith(resolve(rootDir))) {
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
                if (key.startsWith(p) && !key.endsWith('SKILL.md')) {
                    results.push(key.slice(p.length));
                }
            }
            return results;
        },
    };
}

/**
 * Loads a Skill from local disk.
 */
export async function loadSkill(directoryPath: string): Promise<Skill> {
    const skillFile = join(directoryPath, 'SKILL.md');

    let content: string;
    try {
        content = await readFile(skillFile, 'utf-8');
    } catch (error) {
        throw new ParseError(`SKILL.md not found in: ${directoryPath}`, error);
    }

    const { metadata, instructions } = parseSkill(content);

    return createSkill({
        metadata,
        instructions,
        resolver: createFsResolver(directoryPath),
    });
}

/**
 * Discovers skills in a parent directory (reads Tier 1 metadata only).
 */
export async function discoverSkills(parentDirectory: string): Promise<readonly SkillSummary[]> {
    const summaries: SkillSummary[] = [];

    let entries: string[];
    try {
        entries = await readdir(parentDirectory);
    } catch {
        return [];
    }

    for (const entry of entries) {
        const dir = join(parentDirectory, entry);
        try {
            const content = await readFile(join(dir, 'SKILL.md'), 'utf-8');
            const { metadata } = parseSkill(content);
            summaries.push({
                name: metadata.name,
                description: metadata.description,
            });
        } catch {
            // Not a skill folder; ignore
        }
    }

    return summaries;
}
