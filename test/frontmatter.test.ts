import { describe, expect, it } from 'bun:test';
import { ParseError, parseFrontmatter } from '../lib';

describe('parseFrontmatter', () => {
    it('parses frontmatter and body', () => {
        const result = parseFrontmatter('---\ntitle: Hello\n---\nDocument body');

        expect(result).toEqual(['title: Hello', 'Document body']);
    });

    it('handles empty frontmatter and body', () => {
        expect(parseFrontmatter('---\n---\n')).toEqual(['', '']);
    });

    it('strips UTF-8 BOM', () => {
        expect(parseFrontmatter('\uFEFF---\ntitle: Hello\n---\nBody')).toEqual(['title: Hello', 'Body']);
    });

    it('trims frontmatter and body whitespace', () => {
        expect(parseFrontmatter('---\n  title: Hello  \n---\n  Body  ')).toEqual(['title: Hello', 'Body']);
    });

    it('throws when frontmatter is missing', () => {
        expect(() => parseFrontmatter('Document body')).toThrow(ParseError);
    });

    it('throws when frontmatter is not closed', () => {
        expect(() => parseFrontmatter('---\ntitle: Hello')).toThrow(ParseError);
    });

    it('includes filename in error messages', () => {
        expect(() => parseFrontmatter('Invalid content', 'README.md')).toThrow(
            'README.md must start with YAML frontmatter',
        );
    });
});
