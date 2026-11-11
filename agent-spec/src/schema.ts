import { Ajv } from 'ajv';
import * as v from 'valibot';

const ajv = new Ajv({ strict: false });

/**
 * Validates that an object is a syntactically valid JSON Schema.
 * Rejects malformed schemas at manifest-parse time, so downstream
 * model adapters never see garbage.
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

// Tool definitions

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
    name: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'Tool name must be kebab-case')),
    displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
    description: v.pipe(v.string(), v.minLength(10, 'Tool description must be at least 10 characters')),
    inputSchema: JsonSchemaSchema,
    outputSchema: v.optional(JsonSchemaSchema),
    execution: v.optional(HttpExecutionSchema),
});

export type Tool = v.InferOutput<typeof ToolSchema>;

export const ToolRefSchema = v.union([v.string(), ToolSchema]);

export type ToolRef = v.InferOutput<typeof ToolRefSchema>;

// Model and runtime

export const ModelSchema = v.looseObject({
    id: v.pipe(v.string(), v.minLength(1, 'Model id is required')),
    temperature: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(2))),
    topP: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
    topK: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    frequencyPenalty: v.optional(v.pipe(v.number(), v.minValue(-2), v.maxValue(2))),
    presencePenalty: v.optional(v.pipe(v.number(), v.minValue(-2), v.maxValue(2))),
    stopSequences: v.optional(v.array(v.string())),
    seed: v.optional(v.pipe(v.number(), v.integer())),
    reasoningEffort: v.optional(v.picklist(['none', 'minimal', 'low', 'medium', 'high'])),
    maxTokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type Model = v.InferOutput<typeof ModelSchema>;

export const RuntimeSchema = v.strictObject({
    maxSteps: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 6),
    timeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 60000),
});

export type Runtime = v.InferOutput<typeof RuntimeSchema>;

// Locale

export const LocaleSchema = v.strictObject({
    language: v.optional(
        v.pipe(v.string(), v.regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Language must be an ISO 639 tag (e.g. 'es' or 'es-CO')")),
        'en-US',
    ),
    timeZone: v.optional(v.pipe(v.string(), v.minLength(1, "Time zone is required (e.g. 'America/Bogota')")), 'UTC'),
});

export type Locale = v.InferOutput<typeof LocaleSchema>;

// Suggestions

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

// Capabilities

export const KnowledgeCapabilitySchema = v.strictObject({
    sources: v.pipe(v.array(v.string()), v.minLength(1, 'At least one knowledge source is required')),
});

export type KnowledgeCapability = v.InferOutput<typeof KnowledgeCapabilitySchema>;

export const CapabilitiesSchema = v.strictObject({
    knowledge: v.optional(KnowledgeCapabilitySchema),
});

export type Capabilities = v.InferOutput<typeof CapabilitiesSchema>;

// Metadata

export const AgentMetadataSchema = v.looseObject({
    name: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'Manifest name must be kebab-case')),
    version: SemverSchema,
    displayName: v.optional(v.pipe(v.string(), v.minLength(1))),
    description: v.optional(v.pipe(v.string(), v.minLength(1))),
    icon: v.optional(v.string()),
    tags: v.optional(v.array(v.string()), []),
    suggestions: v.optional(v.array(SuggestionSchema), []),
    annotations: v.optional(v.record(v.string(), v.unknown()), {}),
});

export type AgentMetadata = v.InferOutput<typeof AgentMetadataSchema>;

// Spec and root

export const AgentSpecSchema = v.strictObject({
    locale: v.optional(LocaleSchema, v.parse(LocaleSchema, {})),
    model: ModelSchema,
    runtime: v.optional(RuntimeSchema, v.parse(RuntimeSchema, {})),
    capabilities: v.optional(CapabilitiesSchema),
    skills: v.optional(v.array(v.string()), []),
    tools: v.optional(v.array(ToolRefSchema), []),
});

export type AgentSpec = v.InferOutput<typeof AgentSpecSchema>;

export const AgentSchema = v.strictObject({
    apiVersion: v.literal('agent.ekisa.com.co/v1'),
    kind: v.literal('Agent'),
    metadata: AgentMetadataSchema,
    spec: AgentSpecSchema,
});

export type Agent = v.InferOutput<typeof AgentSchema>;
