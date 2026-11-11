import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { ParseError, ValidationError } from './errors';
import type { Agent, Tool } from './schema';
import { validateAgent, validateTool } from './validator';

/**
 * Matches frontmatter enclosed by `---` delimiters at the beginning of a document.
 * Non-greedy matching ensures subsequent `---` rules in Markdown are treated as body content.
 */
const FRONTMATTER_REGEX =
    /^(?:\uFEFF)?[^\S\r\n]*---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n[^\S\r\n]*---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/;

/** Complete representation of an `AGENT.md` document. */
export interface AgentDocument {
    /** The validated manifest from the frontmatter. */
    readonly manifest: Agent;
    /** The system instructions body extracted from the Markdown. */
    readonly instructions: string;
}

function safeYamlParse(raw: string, context: string): unknown {
    try {
        return parseYaml(raw);
    } catch (error) {
        const detail = error instanceof YAMLParseError ? error.message : String(error);
        throw new ParseError(`Failed to parse ${context}: ${detail}`, error);
    }
}

/**
 * Parses an `AGENT.md` document (frontmatter + system instructions body).
 *
 * @param source Raw content of the `AGENT.md` file.
 * @returns The parsed and validated {@link AgentDocument}.
 * @throws {@link ParseError} If frontmatter delimiters are missing or YAML is malformed.
 * @throws {@link ValidationError} If the frontmatter fails schema validation.
 */
export function parseAgent(source: string): AgentDocument {
    if (!source || typeof source !== 'string') {
        throw new ParseError('Source document must be a non-empty string');
    }

    const match = FRONTMATTER_REGEX.exec(source);
    if (!match) {
        if (!source.trimStart().startsWith('---')) {
            throw new ParseError('AGENT.md must begin with frontmatter enclosed by "---"');
        }
        throw new ParseError('AGENT.md frontmatter is missing closing "---" delimiter');
    }

    const frontmatterRaw = match[1] ?? '';
    const instructionsRaw = match[2] ?? '';

    const parsedYaml = safeYamlParse(frontmatterRaw, 'AGENT.md frontmatter');
    const result = validateAgent(parsedYaml);

    if (!result.success) {
        throw new ValidationError('Agent manifest validation failed', result.issues);
    }

    return {
        manifest: result.data,
        instructions: instructionsRaw.trim(),
    };
}

/**
 * Serializes an {@link AgentDocument} into canonical `AGENT.md` format.
 */
export function stringifyAgent(document: AgentDocument): string;
/**
 * Serializes a manifest and optional instructions into canonical `AGENT.md` format.
 */
export function stringifyAgent(manifest: Agent, instructions?: string): string;
export function stringifyAgent(manifestOrDoc: Agent | AgentDocument, instructionsArg?: string): string {
    const isDoc = 'manifest' in manifestOrDoc && typeof manifestOrDoc.manifest === 'object';
    const manifest = isDoc ? manifestOrDoc.manifest : manifestOrDoc;
    const instructions = isDoc ? manifestOrDoc.instructions : (instructionsArg ?? '');

    const yamlBlock = stringifyYaml(manifest).trim();
    const instructionsBody = instructions.trim();

    if (!instructionsBody) {
        return `---\n${yamlBlock}\n---\n`;
    }

    return `---\n${yamlBlock}\n---\n\n${instructionsBody}\n`;
}

/**
 * Parses a standalone YAML or JSON string into a validated {@link Agent} manifest.
 * Used when handling isolated frontmatter blocks without Markdown bodies.
 */
export function parseAgentManifest(source: string): Agent {
    const parsed = safeYamlParse(source, 'Agent');
    const result = validateAgent(parsed);
    if (!result.success) {
        throw new ValidationError('Agent manifest validation failed', result.issues);
    }
    return result.data;
}

/**
 * Serializes an {@link Agent} manifest into formatted YAML.
 */
export function stringifyAgentManifest(manifest: Agent): string {
    return stringifyYaml(manifest);
}

/**
 * Parses a standalone tool YAML or JSON file into a validated {@link Tool}.
 *
 * @param source Raw content of the tool definition file.
 * @returns The validated {@link Tool} definition.
 * @throws {@link ParseError} If syntax is malformed.
 * @throws {@link ValidationError} If the definition violates the schema.
 */
export function parseTool(source: string): Tool {
    const parsed = safeYamlParse(source, 'Tool definition');
    const result = validateTool(parsed);
    if (!result.success) {
        throw new ValidationError('Tool definition validation failed', result.issues);
    }
    return result.data;
}

/**
 * Serializes a {@link Tool} definition into formatted YAML.
 */
export function stringifyTool(tool: Tool): string {
    return stringifyYaml(tool);
}
