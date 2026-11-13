import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { ParseError, parseSchema } from './errors.ts';
import { type FileSystem, normalizePath, scopeFileSystem } from './filesystem.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { type SkillMetadata, type SkillMetadataInput, SkillMetadataSchema } from './schema.ts';

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

/** Tier 1 skill descriptor injected into system instructions (~50-100 tokens). */
export interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly path?: string;
}

/** Descriptor for a Tier 3 resource file bundled with a skill. */
export interface SkillResourceSummary {
    readonly path: string;
    readonly name: string;
    readonly mediaType: string;
}

/** Handle for lazily reading a skill resource as text or bytes. */
export interface SkillResource extends SkillResourceSummary {
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
}

/** Plain input shape accepted by `new Skill(...)` and returned by `skill.toJSON()`. */
export type SkillInput = SkillMetadataInput & {
    readonly instructions?: string;
};

/** Plain validated shape returned by `skill.toJSON()`. */
export type SkillDefinition = SkillMetadata & {
    readonly instructions: string;
};

/** Options accepted by `new Skill(source, options)`. */
export interface SkillOptions {
    /** Overrides `instructions` parsed from `SKILL.md` or supplied on `SkillInput`. */
    readonly instructions?: string;
    /** Backing store used by `listResources()` and `getResource()`. */
    readonly files?: FileSystem;
}

function basename(p: string): string {
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
}

function inferMediaType(filePath: string): string {
    const base = basename(filePath);
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function decodeUtf8(raw: Uint8Array | string): string {
    return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
}

function parseSkillYaml(raw: string): unknown {
    try {
        return parseYaml(raw);
    } catch (error) {
        const detail = error instanceof YAMLParseError ? error.message : String(error);
        throw new ParseError(`Failed to parse SKILL.md frontmatter: ${detail}`, error);
    }
}

/**
 * Validated skill supporting progressive disclosure across three tiers:
 * `SkillSummary` catalog -> `instructions` body -> lazy `getResource` files.
 */
export class Skill {
    /** Validated `SKILL.md` frontmatter fields. */
    readonly metadata: SkillMetadata;
    /** Markdown instruction body. */
    readonly instructions: string;

    readonly #files: FileSystem | undefined;

    /** Skill identifier from `metadata.name`. */
    get name(): string {
        return this.metadata.name;
    }

    /** Skill activation summary from `metadata.description`. */
    get description(): string {
        return this.metadata.description;
    }

    /** Minimal Tier 1 descriptor (`{ name, description }`). */
    get summary(): SkillSummary {
        return { name: this.metadata.name, description: this.metadata.description };
    }

    /**
     * Parses and validates a skill from raw `SKILL.md` content or a {@link SkillInput} object.
     *
     * @throws {@link ParseError} If frontmatter delimiters or YAML syntax are invalid.
     * @throws {@link ValidationError} If metadata fails `SkillMetadataSchema`.
     */
    constructor(source: string | SkillInput, options: SkillOptions = {}) {
        if (typeof source === 'string') {
            const [frontmatter, body] = parseFrontmatter(source, 'SKILL.md');
            const parsedYaml = parseSkillYaml(frontmatter);
            this.metadata = parseSchema(SkillMetadataSchema, parsedYaml, 'Skill metadata validation failed');
            this.instructions = options.instructions !== undefined ? options.instructions.trim() : body;
        } else {
            const { instructions = '', ...metadataInput } = source;
            this.metadata = parseSchema(SkillMetadataSchema, metadataInput, 'Skill metadata validation failed');
            this.instructions = (options.instructions ?? instructions).trim();
        }

        this.#files = options.files;
    }

    /** Loads `SKILL.md` from `files` (optionally scoped to `prefix`) and mounts resource access. */
    static async load(files: FileSystem, prefix = ''): Promise<Skill> {
        const scoped = scopeFileSystem(files, prefix);
        let raw: Uint8Array | string;
        try {
            raw = await scoped.read('SKILL.md');
        } catch (error) {
            throw new ParseError(prefix ? `SKILL.md not found in '${prefix}'` : 'SKILL.md not found', error);
        }

        return new Skill(decodeUtf8(raw), { files: scoped });
    }

    /** Discovers valid skills under `files` (Tier 1 metadata only). */
    static async discover(files: FileSystem, prefix = ''): Promise<readonly SkillSummary[]> {
        const scoped = scopeFileSystem(files, prefix);
        const allPaths = await scoped.list();
        const skillFiles = allPaths.filter((p) => p === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(p));

        return await Promise.all(
            skillFiles.map(async (skillPath) => {
                const content = decodeUtf8(await scoped.read(skillPath));
                const skill = new Skill(content);
                const dir = skillPath === 'SKILL.md' ? '.' : skillPath.slice(0, -'/SKILL.md'.length);
                return {
                    name: skill.name,
                    description: skill.description,
                    path: dir,
                };
            }),
        );
    }

    /** Formats skill summaries into the Tier 1 XML catalog injected into system instructions. */
    static formatCatalog(skills: readonly SkillSummary[]): string {
        if (skills.length === 0) {
            return '';
        }

        const entries = skills.map(
            (s) => `  <skill name="${escapeXml(s.name)}">\n    ${escapeXml(s.description)}\n  </skill>`,
        );
        return `<available_skills>\n${entries.join('\n')}\n</available_skills>`;
    }

    /** Lists all bundled resource files exposed by the attached `FileSystem`. */
    async listResources(): Promise<readonly SkillResourceSummary[]> {
        if (!this.#files) {
            return [];
        }

        const paths = await this.#files.list();
        return paths
            .filter((p) => p !== 'SKILL.md')
            .map((p) => ({
                path: p,
                name: basename(p),
                mediaType: inferMediaType(p),
            }));
    }

    /** Reads a resource file relative to the skill root. */
    async getResource(relativePath: string): Promise<SkillResource> {
        const safePath = normalizePath(relativePath);
        if (!this.#files) {
            throw new ParseError(`Skill '${this.name}' has no FileSystem configured`);
        }

        const raw = await this.#files.read(safePath);

        return {
            path: safePath,
            name: basename(safePath),
            mediaType: inferMediaType(safePath),
            text: async () => decodeUtf8(raw),
            bytes: async () => (typeof raw === 'string' ? new TextEncoder().encode(raw) : raw),
        };
    }

    /** Serializes this skill into canonical `SKILL.md` format. */
    toString(): string {
        const yamlBlock = stringifyYaml(this.metadata).trim();
        return this.instructions ? `---\n${yamlBlock}\n---\n\n${this.instructions}\n` : `---\n${yamlBlock}\n---\n`;
    }

    /** Returns a deep-cloned plain object safe for round-tripping into `new Skill(json)`. */
    toJSON(): SkillDefinition {
        return {
            ...structuredClone(this.metadata),
            instructions: this.instructions,
        };
    }
}
