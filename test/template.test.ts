import { describe, expect, test } from 'vitest';
import { ParseError } from '../lib/errors.ts';
import { resolveTemplate, resolveTemplateRecord } from '../lib/template.ts';

describe('resolveTemplate', () => {
    test('interpolates args and env with optional URL encoding', () => {
        expect(
            resolveTemplate('https://api.com/search?q={{ query }}&n={{count}}', {
                args: { query: 'a & b', count: 2 },
                encodeUrl: true,
            }),
        ).toBe('https://api.com/search?q=a%20%26%20b&n=2');

        expect(
            resolveTemplate('Bearer {{ env.TOKEN }} for {{user}}', {
                args: { user: 'Ada' },
                env: { TOKEN: 'sec_123' },
            }),
        ).toBe('Bearer sec_123 for Ada');
    });

    test('resolves all values in a record', () => {
        expect(
            resolveTemplateRecord(
                { Authorization: 'Bearer {{env.KEY}}', 'X-Tenant': '{{tenant}}' },
                { args: { tenant: 't1' }, env: { KEY: 'k1' } },
            ),
        ).toEqual({ Authorization: 'Bearer k1', 'X-Tenant': 't1' });
    });

    test.each([
        ['{{missing}}', { args: {} }],
        ['{{nullable}}', { args: { nullable: null } }],
        ['{{constructor}}', { args: {} }],
        ['{{env.MISSING}}', { args: {}, env: {} }],
        ['{{env.toString}}', { args: {}, env: {} }],
    ])('throws ParseError on %p', (template, ctx) => {
        expect(() => resolveTemplate(template, ctx)).toThrow(ParseError);
    });
});
