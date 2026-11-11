import { ValidationError } from '../errors';
import type { AgentDocument } from './parser';
import type { AgentInput, Tool, ToolInput } from './schema';
import { validateAgent, validateTool } from './validator';

export * from './parser';
export * from './schema';
export * from './validator';

/**
 * Type-safe authoring helper for an agent document.
 * Applies schema defaults, runs validation, and returns the canonical {@link AgentDocument}.
 *
 * @example
 * const agent = defineAgent(
 *   {
 *     apiVersion: 'agent.ekisa.com.co/v1',
 *     kind: 'Agent',
 *     metadata: { name: 'support-bot', version: '1.0.0' },
 *     spec: { model: { id: 'gpt-4o' } }
 *   },
 *   'You are a support bot.'
 * );
 */
export function defineAgent(manifest: AgentInput, instructions?: string): AgentDocument {
    const result = validateAgent(manifest);
    if (!result.success) {
        throw new ValidationError('Agent manifest validation failed', result.issues);
    }
    return { manifest: result.data, instructions: (instructions ?? '').trim() };
}

/**
 * Type-safe authoring helper for tools.
 * Validates syntax, verifies inputSchema against AJV, and returns a typed {@link Tool}.
 *
 * @example
 * const calc = defineTool({
 *   name: 'calc',
 *   description: 'Evaluates math expressions.',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { expr: { type: 'string' } },
 *     required: ['expr']
 *   }
 * });
 */
export function defineTool(tool: ToolInput): Tool {
    const result = validateTool(tool);
    if (!result.success) {
        throw new ValidationError('Tool definition validation failed', result.issues);
    }
    return result.data;
}
