import { ParseError } from '../errors.ts';

/** Context passed to template resolution functions. */
export interface TemplateContext {
    /** Argument parameters supplied by the model or caller. */
    readonly args: Readonly<Record<string, unknown>>;
    /** Secret mapping for resolving `{{secret.NAME}}` placeholders. */
    readonly secrets?: Readonly<Record<string, string>>;
    /** Whether parameter values should be URL-encoded (for URL templates). */
    readonly encodeUrl?: boolean;
}

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

/**
 * Resolves `{{name}}` and `{{secret.NAME}}` placeholders in a template string.
 *
 * Rules:
 * - A `{{name}}` missing from `args` throws {@link ParseError}.
 * - A `{{secret.NAME}}` missing from `secrets` throws {@link ParseError}.
 * - When `encodeUrl` is `true`, argument values are encoded via `encodeURIComponent`.
 *
 * @param template String containing `{{...}}` expressions.
 * @param context Argument values and secret dictionary.
 * @returns Fully interpolated string.
 * @throws {ParseError} If a parameter or secret is missing.
 */
export function resolveTemplate(template: string, context: TemplateContext): string {
    const { args, secrets = {}, encodeUrl = false } = context;

    return template.replace(/\{\{([^{}]+)\}\}/g, (_, expression: string) => {
        const trimmed = expression.trim();
        if (trimmed.startsWith('secret.')) {
            const secretKey = trimmed.slice(7).trim();
            const secretValue = secrets[secretKey];
            if (secretValue === undefined) {
                throw new ParseError(`Required secret '${secretKey}' was not provided`);
            }
            return secretValue;
        }

        const argValue = args[trimmed];
        if (argValue === undefined || argValue === null) {
            throw new ParseError(`Required template parameter '${trimmed}' is missing from tool arguments`);
        }

        const stringValue = stringifyArg(argValue);
        return encodeUrl ? encodeURIComponent(stringValue) : stringValue;
    });
}

/**
 * Resolves all string values inside a key-value record template.
 *
 * @param record Key-value mapping containing templates in values.
 * @param context Template context.
 * @returns Fully interpolated record.
 */
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
