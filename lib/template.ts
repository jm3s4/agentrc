import { ParseError } from './errors.ts';

/** Inputs available to template interpolation: tool arguments, optional secrets, and URL-encoding behavior. */
export interface TemplateContext {
    readonly args: Readonly<Record<string, unknown>>;
    readonly secrets?: Readonly<Record<string, string>>;
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

/**
 * Interpolates `{{name}}` and `{{secret.NAME}}` placeholders.
 */
export function resolveTemplate(template: string, context: TemplateContext): string {
    const { args, secrets = {}, encodeUrl = false } = context;

    return template.replace(/\{\{([^{}]+)\}\}/g, (_, expression: string) => {
        const trimmed = expression.trim();
        if (trimmed.startsWith('secret.')) {
            const secretKey = trimmed.slice(7).trim();
            const secretValue = Object.hasOwn(secrets, secretKey) ? secrets[secretKey] : undefined;
            if (secretValue === undefined) {
                throw new ParseError(`Required secret '${secretKey}' was not provided`);
            }
            return secretValue;
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
