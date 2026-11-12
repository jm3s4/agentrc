import { parseSchema } from '../errors';
import { SkillMetadataSchema, type SkillMetadata, type SkillMetadataInput, type SkillSummary } from './schema';

export * from './parser';
export * from './resolver';
export * from './schema';
export * from './skill';

/**
 * Type-safe authoring helper for defining an Agent Skill in TypeScript.
 */
export function defineSkill(
    metadata: SkillMetadataInput,
    instructions: string,
): {
    readonly metadata: SkillMetadata;
    readonly instructions: string;
} {
    return {
        metadata: parseSchema(SkillMetadataSchema, metadata, 'Skill metadata validation failed'),
        instructions: instructions.trim(),
    };
}

/**
 * Formats discovered skills into the standard Tier 1 XML catalog block
 * for system prompt injection (~50 tokens per skill).
 */
export function formatSkillCatalog(skills: readonly SkillSummary[]): string {
    if (skills.length === 0) {
        return '';
    }

    const entries = skills.map(
        (s) => `  <skill name="${escapeXml(s.name)}">\n    ${escapeXml(s.description)}\n  </skill>`,
    );
    return `<available_skills>\n${entries.join('\n')}\n</available_skills>`;
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
