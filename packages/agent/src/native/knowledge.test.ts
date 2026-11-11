import { describe, expect, test } from 'bun:test';
import { ParseError } from '../errors';
import { createKnowledgeTool, executeKnowledge, KNOWLEDGE_TOOL_NAME, type KnowledgeRecord } from './knowledge';

describe('createKnowledgeTool', () => {
    test('generates valid Tool definition conforming to capability', () => {
        const tool = createKnowledgeTool({ sources: ['escano-kb'] });

        expect(tool.name).toBe(KNOWLEDGE_TOOL_NAME);
        expect(tool.description).toContain('escano-kb');
        expect(tool.inputSchema.required).toEqual(['query']);
    });
});

describe('executeKnowledge', () => {
    test('enforces tenant sources and passes category to consumer handler', async () => {
        let capturedQuery = '';
        let capturedSources: readonly string[] = [];
        let capturedCategory: string | undefined;

        const mockHandler = async (query: string, ctx: { sources: readonly string[]; category?: string }) => {
            capturedQuery = query;
            capturedSources = ctx.sources;
            capturedCategory = ctx.category;

            const records: KnowledgeRecord[] = [
                { title: 'Fasting Protocol', content: '8 hours required', score: 0.95 },
            ];
            return records;
        };

        const results = await executeKnowledge(
            { sources: ['escano', 'clinic-b'] },
            {
                query: 'mri fasting rules',
                category: 'services',
                handler: mockHandler,
            },
        );

        expect(capturedQuery).toBe('mri fasting rules');
        expect(capturedSources).toEqual(['escano', 'clinic-b']);
        expect(capturedCategory).toBe('services');
        expect(results).toHaveLength(1);
        expect(results[0]?.title).toBe('Fasting Protocol');
    });

    test('throws ParseError on empty or whitespace query', () => {
        expect(executeKnowledge({ sources: ['kb'] }, { query: '   ', handler: async () => [] })).rejects.toThrow(
            ParseError,
        );
    });

    test('throws ParseError if capability has empty sources list', () => {
        expect(executeKnowledge({ sources: [] }, { query: 'valid query', handler: async () => [] })).rejects.toThrow(
            ParseError,
        );
    });
});
