import * as v from 'valibot';
import { toSpecIssues, type ValidationResult } from '../errors.ts';
import { AgentSchema, ToolSchema, type Agent, type Tool } from './schema.ts';

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
