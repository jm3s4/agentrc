import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { ParseError, parseSchema, type SpecIssue, ValidationError, type ValidationResult } from './errors.ts';
import { executeHttp, type HttpSecurityOptions } from './http.ts';
import {
    ajv,
    type HttpExecution,
    type JsonSchemaValidator,
    type ToolDefinition,
    type ToolInput,
    ToolSchema,
} from './schema.ts';

/**
 * Runtime options passed when calling {@link Tool.execute} or binding defaults via {@link Tool.configure}.
 */
export interface ToolExecutionOptions {
    /** Environment dictionary used to resolve `{{env.NAME}}` placeholders. */
    readonly env?: Readonly<Record<string, string>>;
    /** SSRF policy applied before dispatching HTTP requests. */
    readonly security?: HttpSecurityOptions;
    /** Custom `fetch` implementation (useful for proxies, DNS pinning, or tests). */
    readonly fetch?: typeof fetch;
    /** Cancellation signal propagated to handlers and `fetch`. */
    readonly signal?: AbortSignal;
    /** Validate `args` against `inputSchema` via Ajv before execution. Defaults to `true`. */
    readonly validate?: boolean;
}

/**
 * Programmatic handler executed when a {@link Tool} is invoked without (or instead of) an HTTP contract.
 */
export type ToolHandler<TArgs = Record<string, unknown>, TResult = unknown> = (
    args: TArgs,
    context: { readonly signal?: AbortSignal },
) => Promise<TResult> | TResult;

/**
 * Options accepted by `new Tool(source, options)`.
 */
export interface ToolOptions<TArgs = Record<string, unknown>, TResult = unknown> extends Omit<
    ToolExecutionOptions,
    'signal'
> {
    /** Optional in-code handler executed when {@link Tool.execute} is called. */
    readonly handler?: ToolHandler<TArgs, TResult>;
}

function parseToolSource(source: string): unknown {
    try {
        return parseYaml(source);
    } catch (error) {
        const detail = error instanceof YAMLParseError ? error.message : String(error);
        throw new ParseError(`Failed to parse Tool definition: ${detail}`, error);
    }
}

function mergeExecutionOptions(
    base: Omit<ToolExecutionOptions, 'signal'>,
    override: Omit<ToolExecutionOptions, 'signal'>,
): Omit<ToolExecutionOptions, 'signal'> {
    return {
        fetch: override.fetch ?? base.fetch,
        validate: override.validate ?? base.validate,
        env: base.env || override.env ? { ...base.env, ...override.env } : undefined,
        security: base.security || override.security ? { ...base.security, ...override.security } : undefined,
    };
}

/**
 * Validated tool contract with Ajv argument checking, immutable execution binding,
 * and unified invocation for declarative HTTP tools and custom TypeScript handlers.
 *
 * @example
 * ```ts
 * const lookup = new Tool(yamlSource, {
 *     env: { API_KEY: process.env.API_KEY! },
 *     security: { allowedHosts: ['api.example.com'] },
 * });
 *
 * const account = await lookup.execute({ email: 'ada@example.com' });
 * ```
 */
export class Tool<TArgs = Record<string, unknown>, TResult = unknown> {
    /** Kebab-case identifier exposed to the model. */
    readonly name: string;
    /** Optional human-readable label for UI rendering. */
    readonly displayName: string | undefined;
    /** Natural-language description used by the model to decide when to call this tool. */
    readonly description: string;
    /** JSON Schema describing accepted tool arguments. */
    readonly inputSchema: Record<string, unknown>;
    /** Declarative HTTP contract, when defined in the manifest. */
    readonly execution: HttpExecution | undefined;

    readonly #definition: ToolDefinition;
    readonly #handler: ToolHandler<TArgs, TResult> | undefined;
    readonly #defaults: Omit<ToolExecutionOptions, 'signal'>;
    #validator: JsonSchemaValidator | undefined;

    /**
     * Parses and validates a tool from YAML/JSON or a plain definition object.
     *
     * @param source Raw YAML/JSON string or {@link ToolInput} object.
     * @param options Optional handler and default execution bindings.
     * @throws {@link ParseError} If `source` is malformed YAML or JSON.
     * @throws {@link ValidationError} If the tool definition or its `inputSchema` is invalid.
     */
    constructor(source: string | ToolInput, options: ToolOptions<TArgs, TResult> = {}) {
        const raw = typeof source === 'string' ? parseToolSource(source) : source;
        const definition = parseSchema(ToolSchema, raw, 'Tool definition validation failed');

        this.#definition = definition;
        this.#handler = options.handler;
        this.#defaults = {
            env: options.env,
            security: options.security,
            fetch: options.fetch,
            validate: options.validate,
        };
        this.name = definition.name;
        this.displayName = definition.displayName;
        this.description = definition.description;
        this.inputSchema = definition.inputSchema;
        this.execution = definition.execution;
    }

    /**
     * Validates raw arguments against this tool's compiled `inputSchema` without throwing.
     */
    validateInput(args: unknown): ValidationResult<TArgs> {
        this.#validator ??= ajv.compile(this.inputSchema);
        if (this.#validator(args)) {
            return { success: true, data: args as TArgs };
        }

        const issues: SpecIssue[] = (this.#validator.errors ?? []).map((err) => ({
            path: err.instancePath ? err.instancePath.slice(1).replaceAll('/', '.') : 'root',
            message: err.message ?? 'Invalid argument',
        }));
        return { success: false, issues };
    }

    /**
     * Returns a new `Tool` with pre-bound env, SSRF rules, or `fetch` implementation.
     * Does not mutate the original instance.
     */
    configure(defaults: Omit<ToolExecutionOptions, 'signal'>): Tool<TArgs, TResult> {
        const merged = mergeExecutionOptions(this.#defaults, defaults);
        return new Tool<TArgs, TResult>(this.#definition, {
            ...merged,
            handler: this.#handler,
        });
    }

    /**
     * Validates `args` against `inputSchema` (unless `validate: false`) and runs either
     * the bound handler or the declarative HTTP contract.
     *
     * @throws {@link ValidationError} If `args` fail `inputSchema` validation.
     * @throws {@link ParseError} If templates/env are missing, URL fails SSRF checks, or the tool has no executor.
     * @throws {@link HttpError} If the HTTP request fails, times out, or returns a non-2xx status.
     */
    async execute(args: TArgs = {} as TArgs, options: ToolExecutionOptions = {}): Promise<TResult> {
        const merged = mergeExecutionOptions(this.#defaults, options);

        if (merged.validate !== false) {
            const result = this.validateInput(args);
            if (!result.success) {
                throw new ValidationError(`Invalid arguments for tool '${this.name}'`, result.issues);
            }
        }

        if (this.#handler) {
            return await this.#handler(args, { signal: options.signal });
        }

        if (this.execution?.type === 'http') {
            return (await executeHttp(this.execution, this.name, args as Record<string, unknown>, {
                ...merged,
                signal: options.signal,
            })) as TResult;
        }

        throw new ParseError(`Tool '${this.name}' has no execution contract or handler`);
    }

    /** Serializes this tool definition as canonical YAML. */
    toString(): string {
        return stringifyYaml(this.#definition);
    }

    /** Returns a deep-cloned plain definition object safe for round-tripping into `new Tool(json)`. */
    toJSON(): ToolDefinition {
        return structuredClone(this.#definition);
    }
}
