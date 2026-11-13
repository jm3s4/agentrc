import { ParseError, parseSchema } from '../errors';
import {
    SkillMetadataSchema,
    type Skill,
    type SkillMetadata,
    type SkillMetadataInput,
    type SkillResource,
    type SkillResourceResolver,
    type SkillResourceSummary,
    type SkillSummary,
} from './schema';

const MIME_MAP: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.py': 'text/x-python',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
};

function basename(p: string): string {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(i + 1) : p;
}

function extname(p: string): string {
    const base = basename(p);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot) : '';
}

function inferMediaType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Options to create a storage-agnostic skill.
 */
export interface CreateSkillOptions {
    /** Metadata conforming to agentskills.io. Optional fields with defaults may be omitted. */
    readonly metadata: SkillMetadataInput;
    /** Tier 2 instructions markdown body. */
    readonly instructions: string;
    /** Optional pluggable resource resolver (FS, S3, Memory, Database). */
    readonly resolver?: SkillResourceResolver;
}

/**
 * Storage-agnostic factory for creating an Agent Skill.
 * Validates metadata, resolves defaults, and wraps resource retrieval.
 */
export function createSkill(options: CreateSkillOptions): Skill {
    const metadata: SkillMetadata = parseSchema(
        SkillMetadataSchema,
        options.metadata,
        'Skill metadata validation failed',
    );
    const { instructions, resolver } = options;

    return {
        name: metadata.name,
        description: metadata.description,
        metadata,
        instructions,

        async resource(relativePath: string): Promise<SkillResource> {
            if (
                !relativePath ||
                /^([\\/]|[a-zA-Z]:)/.test(relativePath) ||
                relativePath.split(/[\\/]/).includes('..')
            ) {
                throw new ParseError(`Security violation: Invalid resource path (${relativePath})`);
            }

            if (!resolver) {
                throw new ParseError(`Skill '${metadata.name}' has no resource resolver configured`);
            }

            const raw = await resolver.read(relativePath);

            return {
                path: relativePath,
                name: basename(relativePath),
                mediaType: inferMediaType(relativePath),
                text: async () => (typeof raw === 'string' ? raw : new TextDecoder().decode(raw)),
                bytes: async () => (typeof raw === 'string' ? new TextEncoder().encode(raw) : raw),
            };
        },

        async listResources(): Promise<readonly SkillResourceSummary[]> {
            if (!resolver) {
                return [];
            }

            const paths = await resolver.list();
            return paths.map((p) => ({
                path: p,
                name: basename(p),
                mediaType: inferMediaType(p),
            }));
        },
    };
}

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
