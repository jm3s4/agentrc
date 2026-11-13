import { ParseError } from './errors';

/**
 * Parses YAML frontmatter and document body.
 *
 * @param source Document content.
 * @param filename Filename used in error messages.
 * @returns A tuple of [frontmatter, body].
 * @throws {ParseError} If frontmatter is missing or improperly closed.
 */
export function parseFrontmatter(source: string, filename = 'Document'): [frontmatter: string, body: string] {
    const content = source.replace(/^\uFEFF/, ''); // strip BOM

    if (!content.startsWith('---')) {
        throw new ParseError(`${filename} must start with YAML frontmatter (---)`);
    }

    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) {
        throw new ParseError(`${filename} frontmatter not properly closed with ---`);
    }

    const frontmatter = content.slice(3, endIndex).trim();
    const body = content
        .slice(endIndex + 4)
        .replace(/^[^\n]*\n?/, '')
        .trim();

    return [frontmatter, body];
}
