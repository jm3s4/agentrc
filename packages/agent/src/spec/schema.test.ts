import { describe, expect, it, test } from 'bun:test';
import * as v from 'valibot';
import {
    AgentMetadataSchema,
    AgentSchema,
    AgentSpecSchema,
    CapabilitiesSchema,
    HttpExecutionSchema,
    KnowledgeCapabilitySchema,
    LocaleSchema,
    ModelSchema,
    PromptSuggestionSchema,
    RuntimeSchema,
    SuggestionSchema,
    ToolRefSchema,
    ToolSchema,
} from './schema';

function ok<T>(schema: v.GenericSchema<unknown, T>, input: unknown): T {
    return v.parse(schema, input);
}

function fails(schema: v.GenericSchema, input: unknown, messagePart?: string): void {
    const result = v.safeParse(schema, input);
    expect(result.success).toBe(false);
    if (result.success || !messagePart) return;
    expect(result.issues.map((i) => i.message).join(' | ')).toContain(messagePart);
}

const minimalManifest = {
    apiVersion: 'agent.ekisa.com.co/v1',
    kind: 'Agent',
    metadata: { name: 'my-agent', version: '1.0.0' },
    spec: { model: { id: 'gpt-4o' } },
} as const;

const fullManifest = {
    apiVersion: 'agent.ekisa.com.co/v1',
    kind: 'Agent',
    metadata: {
        name: 'support-bot',
        version: '2.1.0-rc.1',
        displayName: 'Support Bot',
        description: 'Answers support tickets',
        icon: 'https://example.com/icon.svg',
        tags: ['support', 'es'],
        suggestions: [
            { type: 'prompt', label: 'Summary', prompt: 'Summarize the ticket' },
            {
                type: 'group',
                label: 'Triage',
                items: [
                    { label: 'Urgent', prompt: 'Is this urgent?' },
                    { label: 'Refund', prompt: 'Is this a refund request?' },
                ],
            },
        ],
        annotations: { team: 'platform' },
    },
    spec: {
        locale: { language: 'es-CO', timeZone: 'America/Bogota' },
        model: { id: 'gpt-4o', temperature: 0.5, maxTokens: 2000 },
        runtime: { maxSteps: 8, timeoutMs: 30000 },
        capabilities: { knowledge: { sources: ['kb/main'] } },
        skills: ['search'],
        tools: [
            'web-search',
            {
                name: 'calc',
                description: 'Evaluates arithmetic expressions.',
                inputSchema: { type: 'object' },
            },
        ],
    },
};

describe('HttpExecutionSchema', () => {
    it('parses a full valid execution', () => {
        expect(
            ok(HttpExecutionSchema, {
                type: 'http',
                method: 'POST',
                url: 'https://api.example.com/{{id}}',
                headers: { Authorization: 'Bearer t' },
                body: { id: 1 },
                timeoutMs: 5000,
            }),
        ).toEqual({
            type: 'http',
            method: 'POST',
            url: 'https://api.example.com/{{id}}',
            headers: { Authorization: 'Bearer t' },
            body: { id: 1 },
            timeoutMs: 5000,
        });
    });

    it('accepts string body', () => {
        ok(HttpExecutionSchema, { type: 'http', method: 'POST', url: 'x', body: '{"raw":1}' });
    });

    test.each(['ftp', 'HTTP', ''])('rejects type %p', (type) => {
        fails(HttpExecutionSchema, { type, method: 'GET', url: 'x' });
    });

    test.each(['HEAD', 'OPTIONS', 'TRACE'])('rejects HTTP method %p', (method) => {
        fails(HttpExecutionSchema, { type: 'http', method, url: 'x' });
    });

    it('rejects empty url', () => {
        fails(HttpExecutionSchema, { type: 'http', method: 'GET', url: '' }, 'URL is required');
    });

    it('rejects extra fields (strictObject)', () => {
        fails(HttpExecutionSchema, { type: 'http', method: 'GET', url: 'x', retries: 3 });
    });
});

describe('ToolDefinitionSchema', () => {
    it('parses a full valid definition', () => {
        expect(
            ok(ToolSchema, {
                name: 'fetcher',
                displayName: 'Fetcher',
                description: 'Fetches data from an HTTP endpoint.',
                inputSchema: { url: { type: 'string' } },
                outputSchema: { data: { type: 'object' } },
                execution: { type: 'http', method: 'GET', url: 'https://x' },
            }),
        ).toEqual({
            name: 'fetcher',
            displayName: 'Fetcher',
            description: 'Fetches data from an HTTP endpoint.',
            inputSchema: { url: { type: 'string' } },
            outputSchema: { data: { type: 'object' } },
            execution: { type: 'http', method: 'GET', url: 'https://x' },
        });
    });

    test.each(['UPPER', 'my_tool', 'my tool', '-leading', 'trailing-', 'double--dash', ''])(
        'rejects non-kebab name %p',
        (name) => fails(ToolSchema, { name, description: 'A valid description here.', inputSchema: {} }, 'kebab-case'),
    );

    it('rejects description shorter than 10 characters', () => {
        fails(ToolSchema, { name: 'a', description: 'short', inputSchema: {} }, 'at least 10 characters');
    });

    it('rejects extra fields (strictObject)', () => {
        fails(ToolSchema, { name: 'a', description: 'A valid description.', inputSchema: {}, version: '1' });
    });
});

describe('ToolDefinitionSchema > inputSchema', () => {
    const base = {
        name: 'calc',
        description: 'Evaluates arithmetic expressions.',
    };

    it('accepts a valid JSON Schema', () => {
        ok(ToolSchema, {
            ...base,
            inputSchema: {
                type: 'object',
                properties: { expr: { type: 'string' } },
                required: ['expr'],
            },
        });
    });

    it('accepts the empty schema {} (accepts anything)', () => {
        ok(ToolSchema, { ...base, inputSchema: {} });
    });

    it('rejects invalid keyword value with Ajv detail', () => {
        fails(ToolSchema, { ...base, inputSchema: { type: 'invalid-type' } }, 'Invalid JSON Schema');
    });

    it('rejects non-object properties', () => {
        fails(
            ToolSchema,
            { ...base, inputSchema: { type: 'object', properties: 'not-an-object' } },
            'Invalid JSON Schema',
        );
    });

    it('rejects boolean root schemas (ecosystem requires object root)', () => {
        fails(ToolSchema, { ...base, inputSchema: true });
        fails(ToolSchema, { ...base, inputSchema: false });
    });

    it('accepts boolean sub-schemas inside object schemas', () => {
        ok(ToolSchema, {
            ...base,
            inputSchema: {
                type: 'object',
                properties: {
                    force: true,
                    strict: false,
                },
            },
        });
    });

    it('rejects array inputSchema', () => {
        fails(ToolSchema, { ...base, inputSchema: [] }, 'not an array');
    });

    it('rejects outputSchema that is an invalid JSON Schema', () => {
        fails(
            ToolSchema,
            {
                ...base,
                inputSchema: {},
                outputSchema: { type: 'invalid-type' },
            },
            'Invalid JSON Schema',
        );
    });
});

describe('ToolRefSchema', () => {
    it('accepts a string reference', () => {
        expect(ok(ToolRefSchema, 'web-search')).toBe('web-search');
    });

    it('accepts an inline ToolDefinition', () => {
        expect(
            ok(ToolRefSchema, {
                name: 'calc',
                description: 'Calculator for arithmetic.',
                inputSchema: {},
            }),
        ).toEqual({ name: 'calc', description: 'Calculator for arithmetic.', inputSchema: {} });
    });

    test.each([[42], [null], [true], [{}], [[]]])('rejects %p', (input) => {
        fails(ToolRefSchema, input);
    });
});

describe('ModelSchema', () => {
    it('requires id', () => {
        fails(ModelSchema, { temperature: 0.5 });
    });

    it('parses minimal input', () => {
        expect(ok(ModelSchema, { id: 'gpt-4o' })).toEqual({ id: 'gpt-4o' });
    });

    it('parses all documented fields', () => {
        const input = {
            id: 'gpt-4o',
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            frequencyPenalty: 0.5,
            presencePenalty: 0.2,
            stopSequences: ['\n\n'],
            seed: 42,
            reasoningEffort: 'medium' as const,
            maxTokens: 4096,
        };
        expect(ok(ModelSchema, input)).toEqual(input);
    });

    test.each([
        ['temperature', -0.1],
        ['temperature', 2.1],
        ['topP', -0.1],
        ['topP', 1.1],
        ['topK', 0],
        ['frequencyPenalty', -2.1],
        ['frequencyPenalty', 2.1],
        ['presencePenalty', 3],
        ['maxTokens', 0],
    ])('rejects out-of-range %s=%p', (field, value) => {
        fails(ModelSchema, { id: 'x', [field]: value });
    });

    it('rejects unknown reasoningEffort', () => {
        fails(ModelSchema, { id: 'x', reasoningEffort: 'max' });
    });

    it('preserves extra fields (looseObject)', () => {
        expect(
            ok(ModelSchema, {
                id: 'claude-sonnet-4',
                provider: 'anthropic',
                cacheControl: { type: 'ephemeral' },
            }),
        ).toMatchInlineSnapshot(`
          {
            "cacheControl": {
              "type": "ephemeral",
            },
            "id": "claude-sonnet-4",
            "provider": "anthropic",
          }
        `);
    });
});

describe('RuntimeSchema', () => {
    it('applies defaults on empty input', () => {
        expect(ok(RuntimeSchema, {})).toEqual({ maxSteps: 6, timeoutMs: 60000 });
    });

    it('keeps provided values', () => {
        expect(ok(RuntimeSchema, { maxSteps: 10 })).toEqual({ maxSteps: 10, timeoutMs: 60000 });
    });

    test.each([
        ['maxSteps', 0],
        ['timeoutMs', 0],
    ])('rejects non-positive %s', (field, value) => {
        fails(RuntimeSchema, { [field]: value });
    });

    it('rejects extra fields (strictObject)', () => {
        fails(RuntimeSchema, { maxSteps: 3, retries: 2 });
    });
});

describe('LocaleSchema', () => {
    it('applies neutral defaults on empty input', () => {
        expect(ok(LocaleSchema, {})).toEqual({ language: 'en-US', timeZone: 'UTC' });
    });

    test.each(['en', 'en-US', 'es-CO', 'pt-BR'])('accepts language %p', (language) => {
        ok(LocaleSchema, { language });
    });

    test.each(['EN', 'english', 'en-us', 'es_CO', 'e'])('rejects language %p', (language) => {
        fails(LocaleSchema, { language }, 'ISO 639');
    });

    it('rejects empty timeZone', () => {
        fails(LocaleSchema, { timeZone: '' }, 'Time zone is required');
    });

    it('rejects extra fields (strictObject)', () => {
        fails(LocaleSchema, { language: 'en', timeZone: 'UTC', currency: 'USD' });
    });
});

describe('PromptSuggestionSchema', () => {
    it('accepts { label, prompt }', () => {
        expect(ok(PromptSuggestionSchema, { label: 'Hi', prompt: 'Say hi' })).toEqual({
            label: 'Hi',
            prompt: 'Say hi',
        });
    });

    test.each([
        { label: '', prompt: 'x' },
        { label: 'x', prompt: '' },
    ])('rejects %p', (input) => {
        fails(PromptSuggestionSchema, input);
    });
});

describe('SuggestionSchema', () => {
    it('parses prompt variant', () => {
        expect(ok(SuggestionSchema, { type: 'prompt', label: 'Hi', prompt: 'Say hi' })).toEqual({
            type: 'prompt',
            label: 'Hi',
            prompt: 'Say hi',
        });
    });

    it('parses group variant', () => {
        expect(
            ok(SuggestionSchema, {
                type: 'group',
                label: 'Triage',
                items: [{ label: 'Urgent', prompt: 'Is it urgent?' }],
            }),
        ).toEqual({
            type: 'group',
            label: 'Triage',
            items: [{ label: 'Urgent', prompt: 'Is it urgent?' }],
        });
    });

    test.each([
        { type: 'group', label: 'Empty', items: [] },
        { type: 'prompt', label: 'Oops' },
        { type: 'link', label: 'x', href: 'y' },
    ])('rejects %p', (input) => {
        fails(SuggestionSchema, input);
    });
});

describe('KnowledgeCapabilitySchema', () => {
    it('accepts at least one source', () => {
        expect(ok(KnowledgeCapabilitySchema, { sources: ['kb/main'] })).toEqual({ sources: ['kb/main'] });
    });

    it('rejects empty sources', () => {
        fails(KnowledgeCapabilitySchema, { sources: [] }, 'At least one knowledge source');
    });

    it('rejects extra fields (strictObject)', () => {
        fails(KnowledgeCapabilitySchema, { sources: ['kb'], reranker: 'bge' });
    });
});

describe('CapabilitiesSchema', () => {
    it('accepts empty object (all disabled)', () => {
        expect(ok(CapabilitiesSchema, {})).toEqual({});
    });

    it('accepts knowledge enabled', () => {
        expect(ok(CapabilitiesSchema, { knowledge: { sources: ['kb/main'] } })).toEqual({
            knowledge: { sources: ['kb/main'] },
        });
    });

    it('rejects unknown capability', () => {
        fails(CapabilitiesSchema, { webSearch: { maxResults: 5 } });
    });
});

describe('AgentMetadataSchema', () => {
    it('parses minimal metadata with defaults', () => {
        expect(ok(AgentMetadataSchema, { name: 'a', version: '1.0.0' })).toMatchInlineSnapshot(`
          {
            "annotations": {},
            "name": "a",
            "suggestions": [],
            "tags": [],
            "version": "1.0.0",
          }
        `);
    });

    test.each(['1.0.0', '2.1.0-rc.1', '0.0.1', '10.20.30', '1.0.0+build.5', '1.0.0-rc.1+build.5'])(
        'accepts SemVer %p',
        (version) => void ok(AgentMetadataSchema, { name: 'a', version }),
    );

    test.each(['1.0', 'v1.0.0', '1.0.0 ', '1.0.0.0', '', '01.0.0', '1.0.0-01'])(
        'rejects invalid SemVer %p',
        (version) => fails(AgentMetadataSchema, { name: 'a', version }, 'SemVer'),
    );

    it('rejects non-kebab name', () => {
        fails(AgentMetadataSchema, { name: 'My_Agent', version: '1.0.0' }, 'kebab-case');
    });

    it('preserves extra fields (looseObject)', () => {
        expect(
            ok(AgentMetadataSchema, {
                name: 'a',
                version: '1.0.0',
                owner: 'platform-team',
                contact: 'platform@example.com',
            }),
        ).toMatchInlineSnapshot(`
          {
            "annotations": {},
            "contact": "platform@example.com",
            "name": "a",
            "owner": "platform-team",
            "suggestions": [],
            "tags": [],
            "version": "1.0.0",
          }
        `);
    });
});

describe('AgentSpecSchema', () => {
    it('parses minimal spec (defaults applied)', () => {
        expect(ok(AgentSpecSchema, { model: { id: 'gpt-4o' } })).toEqual({
            locale: { language: 'en-US', timeZone: 'UTC' },
            model: { id: 'gpt-4o' },
            runtime: { maxSteps: 6, timeoutMs: 60000 },
            skills: [],
            tools: [],
        });
    });

    it('locale omitted -> neutral defaults applied', () => {
        expect(ok(AgentSpecSchema, { model: { id: 'x' } }).locale).toEqual({
            language: 'en-US',
            timeZone: 'UTC',
        });
    });

    it('locale partial -> merged with defaults', () => {
        expect(
            ok(AgentSpecSchema, {
                model: { id: 'x' },
                locale: { language: 'es' },
            }).locale,
        ).toEqual({ language: 'es', timeZone: 'UTC' });
    });

    it('requires model', () => {
        fails(AgentSpecSchema, {});
    });

    it('rejects unknown top-level key (strictObject)', () => {
        fails(AgentSpecSchema, { model: { id: 'x' }, temperatures: 0.5 });
    });
});

describe('AgentManifestSchema', () => {
    it('parses minimal manifest (all defaults resolved)', () => {
        expect(ok(AgentSchema, minimalManifest)).toMatchInlineSnapshot(`
          {
            "apiVersion": "agent.ekisa.com.co/v1",
            "kind": "Agent",
            "metadata": {
              "annotations": {},
              "name": "my-agent",
              "suggestions": [],
              "tags": [],
              "version": "1.0.0",
            },
            "spec": {
              "locale": {
                "language": "en-US",
                "timeZone": "UTC",
              },
              "model": {
                "id": "gpt-4o",
              },
              "runtime": {
                "maxSteps": 6,
                "timeoutMs": 60000,
              },
              "skills": [],
              "tools": [],
            },
          }
        `);
    });

    it('parses full manifest (round-trip)', () => {
        expect(ok(AgentSchema, fullManifest)).toMatchInlineSnapshot(`
          {
            "apiVersion": "agent.ekisa.com.co/v1",
            "kind": "Agent",
            "metadata": {
              "annotations": {
                "team": "platform",
              },
              "description": "Answers support tickets",
              "displayName": "Support Bot",
              "icon": "https://example.com/icon.svg",
              "name": "support-bot",
              "suggestions": [
                {
                  "label": "Summary",
                  "prompt": "Summarize the ticket",
                  "type": "prompt",
                },
                {
                  "items": [
                    {
                      "label": "Urgent",
                      "prompt": "Is this urgent?",
                    },
                    {
                      "label": "Refund",
                      "prompt": "Is this a refund request?",
                    },
                  ],
                  "label": "Triage",
                  "type": "group",
                },
              ],
              "tags": [
                "support",
                "es",
              ],
              "version": "2.1.0-rc.1",
            },
            "spec": {
              "capabilities": {
                "knowledge": {
                  "sources": [
                    "kb/main",
                  ],
                },
              },
              "locale": {
                "language": "es-CO",
                "timeZone": "America/Bogota",
              },
              "model": {
                "id": "gpt-4o",
                "maxTokens": 2000,
                "temperature": 0.5,
              },
              "runtime": {
                "maxSteps": 8,
                "timeoutMs": 30000,
              },
              "skills": [
                "search",
              ],
              "tools": [
                "web-search",
                {
                  "description": "Evaluates arithmetic expressions.",
                  "inputSchema": {
                    "type": "object",
                  },
                  "name": "calc",
                },
              ],
            },
          }
        `);
    });

    it('rejects wrong apiVersion', () => {
        fails(AgentSchema, { ...minimalManifest, apiVersion: 'v2' });
    });

    it('rejects wrong kind', () => {
        fails(AgentSchema, { ...minimalManifest, kind: 'Tool' });
    });

    it('rejects top-level typo (strictObject)', () => {
        fails(AgentSchema, { ...minimalManifest, meta: minimalManifest.metadata });
    });

    it('rejects spec.model.model; must use id', () => {
        fails(AgentSchema, { ...minimalManifest, spec: { model: { model: 'gpt-4o' } } });
    });
});
