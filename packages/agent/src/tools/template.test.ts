import { describe, expect, test } from 'bun:test';
import { ParseError } from '../errors';
import { resolveTemplate, resolveTemplateRecord } from './template';

describe('resolveTemplate', () => {
    test('interpolates arguments with URL encoding when encodeUrl: true', () => {
        const result = resolveTemplate('https://api.com/search?q={{query}}&lang={{lang}}', {
            args: { query: 'diagnostic imaging & radiology', lang: 'es' },
            encodeUrl: true,
        });

        expect(result).toBe('https://api.com/search?q=diagnostic%20imaging%20%26%20radiology&lang=es');
    });

    test('interpolates arguments without URL encoding when encodeUrl: false', () => {
        const result = resolveTemplate('User: {{name}}', {
            args: { name: 'John Doe' },
            encodeUrl: false,
        });

        expect(result).toBe('User: John Doe');
    });

    test('interpolates secrets from {{secret.NAME}} without URL encoding', () => {
        const result = resolveTemplate('Bearer {{secret.API_KEY}}', {
            args: {},
            secrets: { API_KEY: 'live_secret_token_123' },
        });

        expect(result).toBe('Bearer live_secret_token_123');
    });

    test('throws ParseError on missing argument parameter', () => {
        expect(() => resolveTemplate('https://api.com/{{missingParam}}', { args: {} })).toThrow(ParseError);
    });

    test('throws ParseError on missing secret', () => {
        expect(() => resolveTemplate('Bearer {{secret.MISSING_KEY}}', { args: {}, secrets: {} })).toThrow(ParseError);
    });

    test('handles whitespace inside braces gracefully', () => {
        const result = resolveTemplate('{{  param  }} and {{   secret.TOKEN   }}', {
            args: { param: 'val' },
            secrets: { TOKEN: 'sec' },
        });

        expect(result).toBe('val and sec');
    });
});

describe('resolveTemplateRecord', () => {
    test('resolves all template values in a dictionary', () => {
        const headers = {
            Authorization: 'Bearer {{secret.TOKEN}}',
            'X-Tenant-Id': '{{tenant}}',
            'Content-Type': 'application/json',
        };

        const resolved = resolveTemplateRecord(headers, {
            args: { tenant: 'org_abc' },
            secrets: { TOKEN: 'xyz' },
        });

        expect(resolved).toEqual({
            Authorization: 'Bearer xyz',
            'X-Tenant-Id': 'org_abc',
            'Content-Type': 'application/json',
        });
    });
});
