import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { ParseError, parseSchema } from './errors.ts';
import { type FileSystem, normalizePath } from './filesystem.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { HttpSecurityOptions } from './http.ts';
import {
    type AgentManifest,
    type AgentManifestInput,
    AgentSchema,
    type Capabilities,
    type Locale,
    type Model,
    type Runtime,
    type Suggestion,
    type ToolRef,
} from './schema.ts';
import { Skill, type SkillSummary } from './skill.ts';
import { Tool, type ToolExecutionOptions } from './tool.ts';

/** Plain input shape accepted by `new Agent(...)`. */
export type AgentInput = AgentManifestInput & {
    readonly instructions?: string;
};

/** Plain validated shape returned by `agent.toJSON()`. */
export type AgentData = AgentManifest & {
    readonly instructions: string;
};

/**
 * Options for constructing, loading, or configuring an {@link Agent}.
 */
export interface AgentOptions {
    /** Overrides `instructions` parsed from `AGENT.md` or supplied on `AgentInput`. */
    readonly instructions?: string;
    /** Tools bound to the agent (overrides matching names from `manifest.tools`, or adds programmatic tools). */
    readonly tools?: readonly Tool[];
    /** Skills bound to the agent (overrides matching names from `manifest.skills`, or populates `agent.skills`). */
    readonly skills?: readonly Skill[];
    /** Default HTTP env variables pre-bound onto every tool attached to this agent. */
    readonly env?: Readonly<Record<string, string>>;
    /** Default SSRF security policy pre-bound onto every HTTP tool attached to this agent. */
    readonly security?: HttpSecurityOptions;
    /** Custom `fetch` implementation pre-bound onto every HTTP tool attached to this agent. */
    readonly fetch?: typeof fetch;
}

/**
 * Options passed to {@link Agent.buildInstructions}.
 */
export interface BuildInstructionsOptions {
    /** Skill summaries injected as `<available_skills>` XML. Defaults to `agent.skills`. */
    readonly skills?: readonly SkillSummary[];
    /** Trusted key-value runtime context rendered under `## Runtime variables`. */
    readonly variables?: Readonly<Record<string, string>>;
    /** Append localized date/time context derived from `agent.locale`. Defaults to `true`. */
    readonly temporal?: boolean;
    /** Override current time for deterministic tests. */
    readonly now?: Date;
    /** Extra trusted application instructions appended after temporal context. */
    readonly additionalInstructions?: string | readonly string[];
}

/**
 * Assembled system instruction sections separating cacheable prefixes from per-request context.
 */
export interface SystemInstructions {
    /** Agent body plus skill catalog; invariant across turns and safe to prompt-cache. */
    readonly staticInstructions: string;
    /** Per-request runtime variables, localized temporal context, and extra instructions. */
    readonly dynamicInstructions: string;
    /** Joins `staticInstructions` and `dynamicInstructions` for adapters without explicit cache breakpoints. */
    toString(): string;
}

function decodeUtf8(raw: Uint8Array | string): string {
    return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
}

function parseAgentYaml(raw: string): unknown {
    try {
        return parseYaml(raw);
    } catch (error) {
        const detail = error instanceof YAMLParseError ? error.message : String(error);
        throw new ParseError(`Failed to parse AGENT.md frontmatter: ${detail}`, error);
    }
}

function isPathReference(ref: string): boolean {
    return ref.startsWith('./') || ref.includes('/') || /\.(?:ya?ml|json)$/i.test(ref);
}

async function resolveToolFromFiles(files: FileSystem, ref: string): Promise<Tool> {
    const safeRef = normalizePath(ref);
    if (isPathReference(ref)) {
        return new Tool(decodeUtf8(await files.read(safeRef)));
    }

    for (const ext of ['.yaml', '.yml', '.json']) {
        let raw: Uint8Array | string;
        try {
            raw = await files.read(`tools/${safeRef}${ext}`);
        } catch (error) {
            if (error instanceof ParseError && error.message.startsWith('Access denied')) {
                throw error;
            }
            continue;
        }
        return new Tool(decodeUtf8(raw));
    }

    throw new ParseError(`Referenced tool '${ref}' not found in FileSystem`);
}

async function resolveSkillFromFiles(files: FileSystem, ref: string): Promise<Skill> {
    const targetPrefix = isPathReference(ref) ? ref : `skills/${normalizePath(ref)}`;
    return await Skill.load(files, targetPrefix);
}

function formatTemporalContext(locale: Locale, now = new Date()): string {
    const humanDate = new Intl.DateTimeFormat(locale.language, {
        timeZone: locale.timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(now);

    const isoParts = new Intl.DateTimeFormat('en', {
        timeZone: locale.timeZone,
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);

    const year = isoParts.find((p) => p.type === 'year')?.value;
    const month = isoParts.find((p) => p.type === 'month')?.value;
    const day = isoParts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) {
        throw new ParseError('Unable to format ISO date from locale');
    }

    return [
        '## Temporal context',
        `- Time zone: ${locale.timeZone}`,
        `- Current date: ${humanDate} (ISO: ${year}-${month}-${day})`,
    ].join('\n');
}

function toSingleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function formatRuntimeVariables(variables: Readonly<Record<string, string>>): string {
    const entries = Object.entries(variables)
        .map(([key, value]) => [toSingleLine(key), toSingleLine(value)] as const)
        .filter(([key]) => key.length > 0)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `- ${key}: ${value}`);

    return entries.length > 0 ? `## Runtime variables\n${entries.join('\n')}` : '';
}

function normalizeBlocks(content: string | readonly string[] | undefined): string[] {
    if (content === undefined) {
        return [];
    }
    const blocks = typeof content === 'string' ? [content] : content;
    return blocks.map((b) => b.trim()).filter((b) => b.length > 0);
}

/**
 * Validated AI agent owning its manifest, system instructions, tools, and skills.
 *
 * Construct directly from an `AGENT.md` string or manifest object with `new Agent(...)`,
 * or use {@link Agent.load} to resolve external tool and skill references from any {@link FileSystem}.
 */
export class Agent {
    /** Validated frontmatter manifest with schema defaults applied. */
    readonly manifest: AgentManifest;
    /** System instructions body extracted from `AGENT.md` or supplied via input/options. */
    readonly instructions: string;
    /** Resolved, ready-to-run tools attached to this agent. */
    readonly tools: readonly Tool[];
    /** Resolved skills attached to this agent. */
    readonly skills: readonly Skill[];

    readonly #toolMap = new Map<string, Tool>();
    readonly #skillMap = new Map<string, Skill>();

    /** Kebab-case agent identifier. */
    get name(): string {
        return this.manifest.name;
    }

    /** SemVer string. */
    get version(): string {
        return this.manifest.version;
    }

    /** Optional display name. */
    get displayName(): string | undefined {
        return this.manifest.displayName;
    }

    /** Optional description. */
    get description(): string | undefined {
        return this.manifest.description;
    }

    /** Optional icon URL or path. */
    get icon(): string | undefined {
        return this.manifest.icon;
    }

    /** Categorization tags. */
    get tags(): readonly string[] {
        return this.manifest.tags;
    }

    /** Prompt suggestions for UI starters. */
    get suggestions(): readonly Suggestion[] {
        return this.manifest.suggestions;
    }

    /** Model selection and sampling parameters. */
    get model(): Model {
        return this.manifest.model;
    }

    /** Configured language tag and IANA time zone. */
    get locale(): Locale {
        return this.manifest.locale;
    }

    /** Execution guardrails (`maxSteps`, `timeoutMs`). */
    get runtime(): Runtime {
        return this.manifest.runtime;
    }

    /** Optional declarative capabilities (such as `knowledge.sources`). */
    get capabilities(): Capabilities | undefined {
        return this.manifest.capabilities;
    }

    /** Arbitrary application-defined metadata. */
    get metadata(): Readonly<Record<string, unknown>> {
        return this.manifest.metadata;
    }

    /**
     * Parses and validates an agent from raw `AGENT.md` Markdown or an {@link AgentInput} object.
     *
     * @throws {@link ParseError} If frontmatter delimiters or YAML syntax are invalid.
     * @throws {@link ValidationError} If the manifest violates `AgentSchema`.
     */
    constructor(source: string | AgentInput, options: AgentOptions = {}) {
        let parsedManifest: AgentManifest;
        let bodyInstructions: string;

        if (typeof source === 'string') {
            const [frontmatter, body] = parseFrontmatter(source, 'AGENT.md');
            parsedManifest = parseSchema(AgentSchema, parseAgentYaml(frontmatter), 'Agent manifest validation failed');
            bodyInstructions = options.instructions !== undefined ? options.instructions.trim() : body;
        } else {
            const { instructions = '', ...manifestInput } = source;
            parsedManifest = parseSchema(AgentSchema, manifestInput, 'Agent manifest validation failed');
            bodyInstructions = (options.instructions ?? instructions).trim();
        }

        this.manifest = parsedManifest;
        this.instructions = bodyInstructions;

        for (const skill of options.skills ?? []) {
            this.#skillMap.set(skill.name, skill);
        }
        this.skills = [...this.#skillMap.values()];

        const hasDefaults = options.env !== undefined || options.security !== undefined || options.fetch !== undefined;
        const bindDefaults = (tool: Tool): Tool =>
            hasDefaults
                ? tool.configure({
                      env: options.env,
                      security: options.security,
                      fetch: options.fetch,
                  })
                : tool;

        for (const ref of parsedManifest.tools) {
            if (typeof ref !== 'string') {
                const tool = bindDefaults(new Tool(ref));
                this.#toolMap.set(tool.name, tool);
            }
        }

        for (const tool of options.tools ?? []) {
            this.#toolMap.set(tool.name, bindDefaults(tool));
        }

        this.tools = [...this.#toolMap.values()];
    }

    /**
     * Loads `AGENT.md` from `files` and resolves every referenced tool and skill into live instances.
     * Pre-registered `options.tools` and `options.skills` override matching names from the manifest.
     *
     * @throws {@link ParseError} If `AGENT.md` or any referenced file is missing or escapes `files`.
     * @throws {@link ValidationError} If `AGENT.md`, any tool, or any skill fails validation.
     */
    static async load(files: FileSystem, options: Omit<AgentOptions, 'instructions'> = {}): Promise<Agent> {
        let raw: Uint8Array | string;
        try {
            raw = await files.read('AGENT.md');
        } catch (error) {
            throw new ParseError('AGENT.md not found', error);
        }

        const [frontmatter, body] = parseFrontmatter(decodeUtf8(raw), 'AGENT.md');
        const manifest = parseSchema(AgentSchema, parseAgentYaml(frontmatter), 'Agent manifest validation failed');

        const providedTools = new Map((options.tools ?? []).map((t) => [t.name, t]));
        const providedSkills = new Map((options.skills ?? []).map((s) => [s.name, s]));

        const resolveToolRef = async (ref: ToolRef): Promise<Tool> => {
            if (typeof ref !== 'string') {
                return new Tool(ref);
            }
            const existing = providedTools.get(ref);
            return existing ?? (await resolveToolFromFiles(files, ref));
        };

        const resolveSkillRef = async (ref: AgentManifest['skills'][number]): Promise<Skill> => {
            const key = typeof ref === 'string' ? ref : ref.name;
            const existing = providedSkills.get(key);
            return existing ?? (await resolveSkillFromFiles(files, key));
        };

        const [resolvedTools, resolvedSkills] = await Promise.all([
            Promise.all(manifest.tools.map(resolveToolRef)),
            Promise.all(manifest.skills.map(resolveSkillRef)),
        ]);

        return new Agent(manifest, {
            ...options,
            instructions: body,
            tools: [...resolvedTools, ...(options.tools ?? [])],
            skills: [...resolvedSkills, ...(options.skills ?? [])],
        });
    }

    /**
     * Returns a new `Agent` with per-request or per-tenant env, SSRF rules, or `fetch`
     * applied across all attached tools without mutating the original instance.
     */
    configure(defaults: Omit<ToolExecutionOptions, 'signal'>): Agent {
        const configuredTools = this.tools.map((tool) => tool.configure(defaults));
        return new Agent(this.manifest, {
            instructions: this.instructions,
            tools: configuredTools,
            skills: this.skills,
        });
    }

    /** Returns the attached tool with `name`, if present. */
    getTool(name: string): Tool | undefined {
        return this.#toolMap.get(name);
    }

    /** Returns the attached skill with `name`, if present. */
    getSkill(name: string): Skill | undefined {
        return this.#skillMap.get(name);
    }

    /**
     * Assembles separated static and dynamic instruction sections ready for any LLM adapter.
     */
    buildInstructions(options: BuildInstructionsOptions = {}): SystemInstructions {
        const staticSections: string[] = [];
        const dynamicSections: string[] = [];

        if (this.instructions) {
            staticSections.push(this.instructions);
        }

        const catalog = Skill.formatCatalog(options.skills ?? this.skills);
        if (catalog) {
            staticSections.push(catalog);
        }

        if (options.variables) {
            const variables = formatRuntimeVariables(options.variables);
            if (variables) {
                dynamicSections.push(variables);
            }
        }

        if (options.temporal !== false) {
            dynamicSections.push(formatTemporalContext(this.locale, options.now));
        }

        dynamicSections.push(...normalizeBlocks(options.additionalInstructions));

        const staticInstructions = staticSections.join('\n\n');
        const dynamicInstructions = dynamicSections.join('\n\n');

        return {
            staticInstructions,
            dynamicInstructions,
            toString() {
                return [staticInstructions, dynamicInstructions].filter(Boolean).join('\n\n');
            },
        };
    }

    /** Serializes this agent into canonical `AGENT.md` format. */
    toString(): string {
        const yamlBlock = stringifyYaml(this.manifest).trim();
        return this.instructions ? `---\n${yamlBlock}\n---\n\n${this.instructions}\n` : `---\n${yamlBlock}\n---\n`;
    }

    /** Returns a deep-cloned plain object safe for round-tripping into `new Agent(json)`. */
    toJSON(): AgentData {
        return {
            ...structuredClone(this.manifest),
            instructions: this.instructions,
        };
    }
}
