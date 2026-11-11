import { describe, expect, test } from 'bun:test';
import { ParseError } from './errors';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
    test('parses frontmatter and body', () => {
        const result = parseFrontmatter('---\ntitle: Hello\n---\nDocument body');

        expect(result).toEqual(['title: Hello', 'Document body']);
    });

    test('handles empty frontmatter and body', () => {
        expect(parseFrontmatter('---\n---\n')).toEqual(['', '']);
    });

    test('strips UTF-8 BOM', () => {
        expect(parseFrontmatter('\uFEFF---\ntitle: Hello\n---\nBody')).toEqual(['title: Hello', 'Body']);
    });

    test('trims frontmatter and body whitespace', () => {
        expect(parseFrontmatter('---\n  title: Hello  \n---\n  Body  ')).toEqual(['title: Hello', 'Body']);
    });

    test('throws when frontmatter is missing', () => {
        expect(() => parseFrontmatter('Document body')).toThrow(ParseError);
    });

    test('throws when frontmatter is not closed', () => {
        expect(() => parseFrontmatter('---\ntitle: Hello')).toThrow(ParseError);
    });

    test('includes filename in error messages', () => {
        expect(() => parseFrontmatter('Invalid content', 'README.md')).toThrow(
            'README.md must start with YAML frontmatter',
        );
    });
});
