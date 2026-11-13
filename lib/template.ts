import { ParseError } from './errors.ts';

/** Inputs available to template interpolation: tool arguments, optional env, and URL-encoding behavior. */
export interface TemplateContext {
    readonly args: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, string>>;
    readonly encodeUrl?: boolean;
}

/** Converts a resolved argument value to its string form, throwing on unsupported types. */
function stringifyArg(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    throw new ParseError(`Unsupported template argument type: ${typeof value}`);
}

const ENV_PREFIX = 'env.';

/**
 * Interpolates `{{name}}` and `{{env.NAME}}` placeholders.
 */
export function resolveTemplate(template: string, context: TemplateContext): string {
    const { args, env = {}, encodeUrl = false } = context;

    return template.replace(/\{\{([^{}]+)\}\}/g, (_, expression: string) => {
        const trimmed = expression.trim();
        if (trimmed.startsWith(ENV_PREFIX)) {
            const envKey = trimmed.slice(ENV_PREFIX.length).trim();
            const envValue = Object.hasOwn(env, envKey) ? env[envKey] : undefined;
            if (envValue === undefined) {
                throw new ParseError(`Required environment variable '${envKey}' was not provided`);
            }
            return envValue;
        }

        const argValue = Object.hasOwn(args, trimmed) ? args[trimmed] : undefined;
        if (argValue === undefined || argValue === null) {
            throw new ParseError(`Required template parameter '${trimmed}' is missing from tool arguments`);
        }

        const stringValue = stringifyArg(argValue);
        return encodeUrl ? encodeURIComponent(stringValue) : stringValue;
    });
}

/** Resolves every value in a string record through `resolveTemplate`, preserving key order. */
export function resolveTemplateRecord(
    record: Readonly<Record<string, string>>,
    context: TemplateContext,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
        result[key] = resolveTemplate(value, context);
    }
    return result;
}
