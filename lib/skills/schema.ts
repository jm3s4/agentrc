import * as v from 'valibot';

export const SkillNameSchema = v.pipe(
    v.string(),
    v.regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "Skill name must be 1-64 lowercase alphanumeric chars and hyphens (e.g. 'appointment-management')",
    ),
    v.maxLength(64, 'Skill name must not exceed 64 characters'),
);

export const SkillMetadataSchema = v.looseObject({
    /** 1-64 chars, lowercase alphanumeric and hyphens. Matches directory name. */
    name: SkillNameSchema,

    /** 1-1024 characters describing what the skill does and when to activate it. */
    description: v.pipe(
        v.string(),
        v.minLength(1, 'Skill description is required'),
        v.maxLength(1024, 'Skill description must not exceed 1024 characters'),
    ),

    /** License identifier or reference to bundled license file. */
    license: v.optional(v.pipe(v.string(), v.minLength(1))),

    /** Max 500 characters indicating environment requirements. */
    compatibility: v.optional(v.pipe(v.string(), v.maxLength(500))),

    /** Space-separated string of pre-approved tools the skill may use. */
    'allowed-tools': v.optional(v.pipe(v.string(), v.minLength(1))),

    /** Arbitrary key-value metadata mapping string keys to string values. */
    metadata: v.optional(v.record(v.string(), v.string()), () => ({})),
});

export type SkillMetadata = v.InferOutput<typeof SkillMetadataSchema>;

export type SkillMetadataInput = v.InferInput<typeof SkillMetadataSchema>;

/** Tier 1 Descriptor: Minimal metadata loaded at session start (~50-100 tokens). */
export interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly path?: string;
}

/** Descriptor for an on-demand resource file (Tier 3 progressive disclosure). */
export interface SkillResourceSummary {
    /** Relative path inside the skill directory (e.g. "references/policy.md"). */
    readonly path: string;
    /** File name (e.g. "policy.md"). */
    readonly name: string;
    /** Inferred media type (e.g. "text/markdown"). */
    readonly mediaType: string;
}

/** Executable handle to read an on-demand resource file. */
export interface SkillResource extends SkillResourceSummary {
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
}

/**
 * Storage-agnostic resolver. Plugs into disk, S3, databases, or in-memory maps.
 */
export interface SkillResourceResolver {
    read(relativePath: string): Promise<Uint8Array | string>;
    list(): Promise<readonly string[]>;
}

/** Complete representation of an Agent Skill conforming to [agentskills.io](https://agentskills.io/). */
export interface Skill {
    readonly name: string;
    readonly description: string;
    readonly metadata: SkillMetadata;
    readonly instructions: string;
    resource(relPath: string): Promise<SkillResource>;
    listResources(): Promise<readonly SkillResourceSummary[]>;
}
