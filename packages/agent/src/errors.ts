import * as v from 'valibot';

/** A specific validation issue found in a document. */
export interface SpecIssue {
    readonly path: string;
    readonly message: string;
}

/** Result shape returned by non-throwing validation functions. */
export type ValidationResult<T> =
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly issues: readonly SpecIssue[] };

/** Thrown when YAML or JSON syntax is malformed. */
export class ParseError extends Error {
    override readonly name = 'ParseError';
    constructor(
        message: string,
        override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/** Thrown when a document violates the schema. */
export class ValidationError extends Error {
    override readonly name = 'ValidationError';
    constructor(
        message: string,
        readonly issues: readonly SpecIssue[],
    ) {
        const detail = issues.map((i) => `  - [${i.path}]: ${i.message}`).join('\n');
        super(`${message}\n${detail}`);
    }
}

function formatPath(issue: v.BaseIssue<unknown>): string {
    if (!issue.path || issue.path.length === 0) {
        return 'root';
    }

    return issue.path
        .map((item) => {
            const key = item.key;
            return typeof key === 'symbol' ? key.toString() : String(key);
        })
        .join('.');
}

export function toSpecIssues(issues: readonly v.BaseIssue<unknown>[]): readonly SpecIssue[] {
    return issues.map((issue) => ({
        path: formatPath(issue),
        message: issue.message,
    }));
}
