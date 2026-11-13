import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ParseError } from '../../errors';
import { parseSkill } from '../../skills/parser';
import type { Skill, SkillSummary } from '../../skills/schema';
import { createSkill } from '../../skills/skill';
import { createFsResolver } from './resolver';

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
        let content: string;
        try {
            content = await readFile(join(dir, 'SKILL.md'), 'utf-8');
        } catch {
            continue; // Not a skill folder; ignore
        }

        const { metadata } = parseSkill(content);
        summaries.push({
            name: metadata.name,
            description: metadata.description,
            path: dir,
        });
    }

    return summaries;
}
