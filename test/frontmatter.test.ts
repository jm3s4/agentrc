import { describe, expect, test } from 'vitest';
import { ParseError } from '../lib/errors.ts';
import { parseFrontmatter } from '../lib/frontmatter.ts';

describe('parseFrontmatter', () => {
    test('splits valid frontmatter and body while preserving horizontal rules', () => {
        const [fm, body] = parseFrontmatter('\uFEFF---\r\nname: test\r\n---\r\nHello\r\n\r\n---\r\n\r\nWorld');

        expect(fm).toBe('name: test');
        expect(body).toBe('Hello\r\n\r\n---\r\n\r\nWorld');
    });

    test('handles empty frontmatter and body', () => {
        expect(parseFrontmatter('---\n---\n')).toEqual(['', '']);
    });

    test('ignores --- inside frontmatter scalars when not a closing delimiter line', () => {
        const [fm, body] = parseFrontmatter('---\ntitle: "---not-closing"\n---\nBody');
        expect(fm).toBe('title: "---not-closing"');
        expect(body).toBe('Body');
    });

    test.each(['Body only', '---garbage\nname: x\n---\nBody', '---\nname: unclosed'])(
        'rejects malformed delimiters %p',
        (input) => {
            expect(() => parseFrontmatter(input, 'AGENT.md')).toThrow(ParseError);
        },
    );
});
