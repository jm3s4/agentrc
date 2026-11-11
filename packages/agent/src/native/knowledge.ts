import { ParseError } from '../errors';
import type { KnowledgeCapability, Tool } from '../spec';

/** Canonical tool name for the native knowledge capability. */
export const KNOWLEDGE_TOOL_NAME = 'search-knowledge';

/** Normalized knowledge hit record returned to the agent. */
export interface KnowledgeRecord {
    /** Title or source document identifier. */
    readonly title: string;
    /** The textual content or excerpt. */
    readonly content: string;
    /** Optional similarity or relevance score (0.0 to 1.0). */
    readonly score?: number;
    /** Optional category or subcategory tag. */
    readonly category?: string;
    /** Arbitrary document payload metadata. */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Contextual information passed to the consumer's search provider. */
export interface KnowledgeSearchContext {
    /** The tenant or knowledge sources declared in the manifest. */
    readonly sources: readonly string[];
    /** Optional category filter passed by the model. */
    readonly category?: string;
    /** Optional cancellation signal. */
    readonly signal?: AbortSignal;
}

/**
 * Storage-agnostic search handler contract.
 * Implemented by the consumer using Qdrant, Pinecone, pgvector, or any custom backend.
 *
 * The handler owns category semantics: `context.category` is an opaque,
 * model-supplied string and the handler is responsible for validating or
 * ignoring unknown values.
 */
export type KnowledgeSearchHandler = (
    query: string,
    context: KnowledgeSearchContext,
) => Promise<readonly KnowledgeRecord[]>;

/** Options to override the knowledge tool. */
export type KnowledgeToolOptions = Pick<Tool, 'name' | 'displayName' | 'description'>;

/** Options to execute the knowledge tool. */
export interface ExecuteKnowledgeOptions {
    /** The search query string passed by the model. */
    readonly query: string;
    /** Optional category filter; interpreted by the handler. */
    readonly category?: string;
    /** Consumer-supplied search handler. */
    readonly handler: KnowledgeSearchHandler;
    /** Optional cancellation signal. */
    readonly signal?: AbortSignal;
}

/**
 * Creates the standard Tool definition for the native knowledge capability.
 *
 * @param capability The knowledge capability from `spec.capabilities.knowledge`.
 * @param options Optional overrides for tool naming or description.
 * @returns A validated {@link Tool} definition for the model.
 */
export function createKnowledgeTool(capability: KnowledgeCapability, options?: KnowledgeToolOptions): Tool {
    const sourcesSummary = capability.sources.join(', ');

    return {
        name: options?.name ?? KNOWLEDGE_TOOL_NAME,
        displayName: options?.displayName ?? 'Search Knowledge Base',
        description:
            options?.description ??
            `Retrieves relevant information from the configured knowledge sources when an answer depends on external or source-backed content. Prefer this tool over guessing. Returns the most relevant excerpts. Configured sources: [${sourcesSummary}].`,
        inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
                query: {
                    type: 'string',
                    description: 'Natural language search query or keywords.',
                },
                category: {
                    type: 'string',
                    description: 'Optional category filter. Interpreted by the search backend; omit if unsure.',
                },
            },
        },
    };
}

/**
 * Dispatches a knowledge search using the consumer's search handler.
 * Validates queries and guarantees tenant source constraints are enforced.
 *
 * @param capability The knowledge capability from the agent manifest.
 * @param options Query, category, and consumer search handler.
 * @returns Array of normalized {@link KnowledgeRecord} objects.
 * @throws {ParseError} If the query is empty or no sources are configured.
 */
export async function executeKnowledge(
    capability: KnowledgeCapability,
    options: ExecuteKnowledgeOptions,
): Promise<readonly KnowledgeRecord[]> {
    const query = options.query?.trim();
    if (!query) {
        throw new ParseError('Knowledge search query cannot be empty');
    }

    if (!capability.sources || capability.sources.length === 0) {
        throw new ParseError('Knowledge capability has no sources configured');
    }

    return await options.handler(query, {
        sources: capability.sources,
        category: options.category,
        signal: options.signal,
    });
}
