import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { ParseError, parseSchema } from '../errors.ts';
import { parseFrontmatter } from '../frontmatter.ts';
import { SkillMetadataSchema, type SkillMetadata, type SkillMetadataInput } from './schema.ts';

/** Parsed skill metadata and instructions. */
export interface ParsedSkill {
    /* Validated skill metadata. */
    readonly metadata: SkillMetadata;
    /* Skill instruction body. */
    readonly instructions: string;
}

/**
 * Parses raw `SKILL.md` content into validated metadata and instruction body.
 *
 * @param source Raw content of the SKILL.md file.
 * @returns Parsed metadata and instructions.
 * @throws {ParseError} If frontmatter is missing or YAML syntax is broken.
 * @throws {ValidationError} If metadata fails agentskills.io schema validation.
 */
export function parseSkill(source: string): ParsedSkill {
    const [frontmatter, instructions] = parseFrontmatter(source, 'SKILL.md');

    let parsedYaml: unknown;
    try {
        parsedYaml = parseYaml(frontmatter);
    } catch (error) {
        const detail = error instanceof YAMLParseError ? error.message : String(error);
        throw new ParseError(`Failed to parse SKILL.md frontmatter: ${detail}`, error);
    }

    return {
        metadata: parseSchema(SkillMetadataSchema, parsedYaml, 'Skill metadata validation failed'),
        instructions,
    };
}

/**
 * Serializes metadata and instructions into canonical `SKILL.md` format.
 */
export function stringifySkill(metadata: SkillMetadataInput, instructions = ''): string {
    const validated = parseSchema(SkillMetadataSchema, metadata, 'Skill metadata validation failed');
    const yamlBlock = stringifyYaml(validated).trim();
    const body = instructions.trim();

    return body ? `---\n${yamlBlock}\n---\n\n${body}\n` : `---\n${yamlBlock}\n---\n`;
}
