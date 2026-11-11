import * as v from 'valibot';
import type { SpecIssue, ValidationResult } from './errors';
import { AgentSchema, ToolSchema, type Agent, type Tool } from './schema';

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

/**
 * Validates unknown data against the {@link AgentSchema} without throwing.
 */
export function validateAgent(data: unknown): ValidationResult<Agent> {
    const result = v.safeParse(AgentSchema, data);
    if (result.success) {
        return { success: true, data: result.output };
    }
    return { success: false, issues: toSpecIssues(result.issues) };
}

/**
 * Validates unknown data against the {@link ToolSchema} without throwing.
 */
export function validateTool(data: unknown): ValidationResult<Tool> {
    const result = v.safeParse(ToolSchema, data);
    if (result.success) {
        return { success: true, data: result.output };
    }
    return { success: false, issues: toSpecIssues(result.issues) };
}
