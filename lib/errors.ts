import * as v from 'valibot';

/** Validation issue reported for a specific path in a document or argument payload. */
export interface SpecIssue {
    readonly path: string;
    readonly message: string;
}

/** Discriminated result returned by non-throwing validation helpers such as `Tool.validateInput`. */
export type ValidationResult<T> =
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly issues: readonly SpecIssue[] };

/** Thrown on syntax, IO, path, template, or SSRF policy failures. */
export class ParseError extends Error {
    override readonly name = 'ParseError';

    constructor(message: string, cause?: unknown) {
        super(message, cause !== undefined ? { cause } : undefined);
    }
}

/** Thrown when an HTTP tool fails at transport, timeout, or status level. */
export class HttpError extends Error {
    override readonly name = 'HttpError';
    readonly status: number;

    constructor(message: string, status: number, cause?: unknown) {
        super(message, cause !== undefined ? { cause } : undefined);
        this.status = status;
    }
}

/** Thrown when an agent, skill, tool definition, or tool call violates its schema. */
export class ValidationError extends Error {
    override readonly name = 'ValidationError';
    readonly issues: readonly SpecIssue[];

    constructor(message: string, issues: readonly SpecIssue[]) {
        const detail = issues.map((i) => `  - [${i.path}]: ${i.message}`).join('\n');
        super(`${message}\n${detail}`);
        this.issues = issues;
    }
}

/** Normalizes valibot issues into flat spec issues, using `'root'` for issues with no path. */
export function toSpecIssues(issues: readonly v.BaseIssue<unknown>[]): readonly SpecIssue[] {
    return issues.map((issue) => ({
        path: issue.path?.length
            ? issue.path
                  .map((item) => (typeof item.key === 'symbol' ? item.key.toString() : String(item.key)))
                  .join('.')
            : 'root',
        message: issue.message,
    }));
}

/** Throwing counterpart to `v.safeParse` that validates `data` and wraps failures in a `ValidationError`. */
export function parseSchema<T>(schema: v.GenericSchema<unknown, T>, data: unknown, message: string): T {
    const result = v.safeParse(schema, data);
    if (result.success) {
        return result.output;
    }
    throw new ValidationError(message, toSpecIssues(result.issues));
}
