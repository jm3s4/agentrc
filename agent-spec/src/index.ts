import * as v from 'valibot';
import type { AgentDocument } from './parser';
import { AgentSchema, ToolSchema, type Agent, type Tool } from './schema';

export * from './errors';
export * from './parser';
export * from './schema';
export * from './validator';

export interface AgentDocumentInput {
    readonly manifest: Agent;
    readonly instructions?: string;
}

function isDocumentInput(input: unknown): input is AgentDocumentInput {
    return typeof input === 'object' && input !== null && 'manifest' in input;
}

/**
 * Type-safe authoring helper for an agent document.
 * Applies schema defaults, runs validation, and returns the canonical {@link AgentDocument}.
 *
 * @example
 * // Style A: Unified document object
 * const agent = defineAgent({
 *   manifest: {
 *     apiVersion: 'agent.ekisa.com.co/v1',
 *     kind: 'Agent',
 *     metadata: { name: 'support-bot', version: '1.0.0' },
 *     spec: { model: { id: 'gpt-4o' } }
 *   },
 *   instructions: 'You are a support bot.'
 * });
 *
 * @example
 * // Style B: Manifest + instructions as arguments
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
export function defineAgent(document: AgentDocumentInput): AgentDocument;
export function defineAgent(manifest: Agent, instructions?: string): AgentDocument;
export function defineAgent(manifestOrDoc: Agent | AgentDocumentInput, instructionsArg?: string): AgentDocument {
    if (isDocumentInput(manifestOrDoc)) {
        return {
            manifest: v.parse(AgentSchema, manifestOrDoc.manifest),
            instructions: (manifestOrDoc.instructions ?? '').trim(),
        };
    }

    return {
        manifest: v.parse(AgentSchema, manifestOrDoc),
        instructions: (instructionsArg ?? '').trim(),
    };
}

/**
 * Type-safe authoring helper for pure frontmatter manifests (without instructions).
 */
export function defineAgentManifest(manifest: Agent): Agent {
    return v.parse(AgentSchema, manifest);
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
export function defineTool(tool: Tool): Tool {
    return v.parse(ToolSchema, tool);
}
