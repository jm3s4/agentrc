import { describe, expect, test } from 'vitest';
import { ParseError, ValidationError } from '../lib/errors.ts';
import { Tool } from '../lib/tool.ts';

const lookupYaml = `
name: lookup-account
description: Looks up customer account status by email address.
inputSchema:
  type: object
  required: [email]
  properties:
    email:
      type: string
execution:
  type: http
  method: GET
  url: https://api.example.com/accounts?email={{email}}
  headers:
    Authorization: Bearer {{env.API_KEY}}
`;

describe('Tool', () => {
    test('constructs from YAML or object and round-trips toJSON / toString', () => {
        const fromYaml = new Tool(lookupYaml);
        const fromJson = new Tool(fromYaml.toJSON());
        const reparsed = new Tool(fromYaml.toString());

        expect(fromJson.toJSON()).toEqual(fromYaml.toJSON());
        expect(reparsed.toJSON()).toEqual(fromYaml.toJSON());
    });

    test('rejects invalid definitions and broken JSON Schemas', () => {
        expect(() => new Tool({ name: 'BAD_NAME', description: 'Valid description.', inputSchema: {} })).toThrow(
            ValidationError,
        );
        expect(
            () => new Tool({ name: 'bad-schema', description: 'Valid description.', inputSchema: { type: 'bogus' } }),
        ).toThrow(ValidationError);
        expect(() => new Tool('name: [unclosed')).toThrow(ParseError);
    });

    test('validates arguments with Ajv before execution', async () => {
        let called = false;
        const tool = new Tool(
            {
                name: 'greet',
                description: 'Greets a user by name.',
                inputSchema: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string' } },
                },
            },
            {
                handler: async ({ name }) => {
                    called = true;
                    return `hi ${String(name)}`;
                },
            },
        );

        await expect(tool.execute({})).rejects.toThrow(ValidationError);
        expect(called).toBe(false);

        expect(await tool.execute({ name: 'Ada' })).toBe('hi Ada');
        expect(await tool.execute({}, { validate: false })).toBe('hi undefined');
    });

    test('configure() returns an immutable copy and merges secrets', async () => {
        const mockFetch = (async (_url: unknown, init?: RequestInit) =>
            new Response(
                JSON.stringify({
                    auth: new Headers(init?.headers).get('Authorization'),
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            )) as unknown as typeof fetch;

        const base = new Tool(lookupYaml, { fetch: mockFetch });
        const bound = base.configure({ env: { API_KEY: 'secret-1' } });

        await expect(base.execute({ email: 'a@b.com' })).rejects.toThrow(ParseError);
        expect(await bound.execute({ email: 'a@b.com' })).toEqual({ auth: 'Bearer secret-1' });
    });

    test('throws ParseError when tool has no execution or handler', async () => {
        const noop = new Tool({ name: 'noop-tool', description: 'Schema only tool.', inputSchema: { type: 'object' } });
        await expect(noop.execute({})).rejects.toThrow(ParseError);
    });
});
