import { basename, extname } from 'node:path';
import * as v from 'valibot';
import { ParseError } from '../errors';
import {
    SkillMetadataSchema,
    type Skill,
    type SkillMetadata,
    type SkillMetadataInput,
    type SkillResource,
    type SkillResourceResolver,
    type SkillResourceSummary,
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
    const metadata: SkillMetadata = v.parse(SkillMetadataSchema, options.metadata);
    const { instructions, resolver } = options;

    return {
        name: metadata.name,
        description: metadata.description,
        metadata,
        instructions,

        async resource(relativePath: string): Promise<SkillResource> {
            // Prevent path traversal
            if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
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
