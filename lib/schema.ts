import { Ajv } from 'ajv';
import * as v from 'valibot';

export const ajv = new Ajv({ strict: false });

export type JsonSchemaValidator = ReturnType<Ajv['compile']>;

/**
 * Validates that a value is an object JSON Schema accepted by Ajv.
 * Rejects boolean root schemas and malformed definitions at parse time.
 */
export const JsonSchemaSchema = v.pipe(
    v.unknown(),
    v.rawCheck(({ dataset, addIssue }) => {
        if (!dataset.typed) {
            return;
        }
        const value = dataset.value;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            addIssue({ message: 'JSON Schema must be an object, not an array' });
            return;
        }
        if (!ajv.validateSchema(value)) {
            const detail = (ajv.errors ?? [])
                .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
                .join('; ');
            addIssue({ message: `Invalid JSON Schema: ${detail || 'schema did not validate'}` });
        }
    }),
    v.record(v.string(), v.unknown()),
);

/** @see https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string */
const SEMVER_REGEX =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const SemverSchema = v.pipe(
    v.string(),
    v.regex(SEMVER_REGEX, "Version must be a valid SemVer string (e.g. '1.4.0', '2.0.0-beta.1')"),
);

const KebabNameSchema = (label: string) =>
    v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${label} must be kebab-case`));

function isValidTimeZone(timeZone: string): boolean {
    try {
        Intl.DateTimeFormat(undefined, { timeZone });
        return true;
    } catch {
        return false;
    }
}

// Skills

export const SkillNameSchema = v.pipe(
    v.string(),
    v.regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "Skill name must be 1-64 lowercase alphanumeric chars and hyphens (e.g. 'appointment-management')",
    ),
    v.maxLength(64, 'Skill name must not exceed 64 characters'),
);

export const SkillMetadataSchema = v.looseObject({
    name: SkillNameSchema,
    description: v.pipe(
        v.string(),
        v.minLength(1, 'Skill description is required'),
        v.maxLength(1024, 'Skill description must not exceed 1024 characters'),
    ),
    license: v.optional(v.pipe(v.string(), v.minLength(1))),
    compatibility: v.optional(v.pipe(v.string(), v.maxLength(500))),
    'allowed-tools': v.optional(v.pipe(v.string(), v.minLength(1))),
    metadata: v.optional(v.record(v.string(), v.string()), () => ({})),
});

export type SkillMetadata = v.InferOutput<typeof SkillMetadataSchema>;

export type SkillMetadataInput = v.InferInput<typeof SkillMetadataSchema>;

export const SkillRefSchema = v.union([
    v.string(),
    v.strictObject({
        name: SkillNameSchema,
        version: SemverSchema,
    }),
]);

export type SkillRef = v.InferOutput<typeof SkillRefSchema>;

// Tools

export const HttpExecutionSchema = v.strictObject({
    type: v.literal('http'),
    method: v.picklist(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: v.pipe(v.string(), v.minLength(1, 'URL is required')),
    headers: v.optional(v.record(v.string(), v.string())),
    body: v.optional(v.union([v.record(v.string(), v.unknown()), v.string()])),
    timeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type HttpExecution = v.InferOutput<typeof HttpExecutionSchema>;

export const ToolSchema = v.strictObject({
    name: KebabNameSchema('Tool name'),
    displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
    description: v.pipe(v.string(), v.minLength(10, 'Tool description must be at least 10 characters')),
    inputSchema: JsonSchemaSchema,
    execution: v.optional(HttpExecutionSchema),
});

export type ToolDefinition = v.InferOutput<typeof ToolSchema>;

export type ToolInput = v.InferInput<typeof ToolSchema>;

export const ToolRefSchema = v.union([v.string(), ToolSchema]);

export type ToolRef = v.InferOutput<typeof ToolRefSchema>;

// Model, runtime, locale, suggestions, capabilities

export const ModelSchema = v.looseObject({
    id: v.pipe(v.string(), v.minLength(1, 'Model id is required')),
    temperature: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(2))),
    topP: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
    topK: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    frequencyPenalty: v.optional(v.pipe(v.number(), v.minValue(-2), v.maxValue(2))),
    presencePenalty: v.optional(v.pipe(v.number(), v.minValue(-2), v.maxValue(2))),
    stopSequences: v.optional(v.array(v.string())),
    seed: v.optional(v.pipe(v.number(), v.integer())),
    reasoningEffort: v.optional(v.picklist(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])),
    maxTokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type Model = v.InferOutput<typeof ModelSchema>;

export const RuntimeSchema = v.strictObject({
    maxSteps: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 6),
    timeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 60000),
});

export type Runtime = v.InferOutput<typeof RuntimeSchema>;

export const LocaleSchema = v.strictObject({
    language: v.optional(
        v.pipe(v.string(), v.regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Language must be an ISO 639 tag (e.g. 'es' or 'es-CO')")),
        'en-US',
    ),
    timeZone: v.optional(
        v.pipe(
            v.string(),
            v.minLength(1, "Time zone is required (e.g. 'America/Bogota')"),
            v.check(isValidTimeZone, "Time zone must be a valid IANA identifier (e.g. 'America/Bogota', 'UTC')"),
        ),
        'UTC',
    ),
});

export type Locale = v.InferOutput<typeof LocaleSchema>;

export const PromptSuggestionSchema = v.strictObject({
    label: v.pipe(v.string(), v.minLength(1)),
    prompt: v.pipe(v.string(), v.minLength(1)),
});

export type PromptSuggestion = v.InferOutput<typeof PromptSuggestionSchema>;

export const SuggestionSchema = v.variant('type', [
    v.strictObject({
        type: v.literal('prompt'),
        ...PromptSuggestionSchema.entries,
    }),
    v.strictObject({
        type: v.literal('group'),
        label: v.pipe(v.string(), v.minLength(1)),
        items: v.pipe(v.array(PromptSuggestionSchema), v.minLength(1)),
    }),
]);

export type Suggestion = v.InferOutput<typeof SuggestionSchema>;

export const KnowledgeCapabilitySchema = v.strictObject({
    sources: v.pipe(v.array(v.string()), v.minLength(1, 'At least one knowledge source is required')),
});

export type KnowledgeCapability = v.InferOutput<typeof KnowledgeCapabilitySchema>;

export const CapabilitiesSchema = v.strictObject({
    knowledge: v.optional(KnowledgeCapabilitySchema),
});

export type Capabilities = v.InferOutput<typeof CapabilitiesSchema>;

// Agent manifest (flat)

export const AgentSchema = v.strictObject({
    name: KebabNameSchema('Agent name'),
    version: SemverSchema,
    displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
    description: v.optional(v.pipe(v.string(), v.minLength(1))),
    icon: v.optional(v.string()),
    tags: v.optional(v.array(v.string()), () => []),
    suggestions: v.optional(v.array(SuggestionSchema), () => []),
    locale: v.optional(LocaleSchema, () => v.parse(LocaleSchema, {})),
    model: ModelSchema,
    runtime: v.optional(RuntimeSchema, () => v.parse(RuntimeSchema, {})),
    capabilities: v.optional(CapabilitiesSchema),
    skills: v.optional(v.array(SkillRefSchema), () => []),
    tools: v.optional(v.array(ToolRefSchema), () => []),
    metadata: v.optional(v.record(v.string(), v.unknown()), () => ({})),
});

export type AgentManifest = v.InferOutput<typeof AgentSchema>;

export type AgentManifestInput = v.InferInput<typeof AgentSchema>;
