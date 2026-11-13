import { ParseError } from './errors.ts';

/** Splits a Markdown document into trimmed `[frontmatter, body]` sections. */
export function parseFrontmatter(source: string, filename = 'Document'): [frontmatter: string, body: string] {
    const content = source.replace(/^\uFEFF/, '');

    if (!/^---[ \t]*\r?\n/.test(content)) {
        throw new ParseError(`${filename} must start with YAML frontmatter (---)`);
    }

    const closeMatch = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(content.slice(3));
    if (!closeMatch) {
        throw new ParseError(`${filename} frontmatter not properly closed with ---`);
    }

    const closeStart = 3 + closeMatch.index;
    const frontmatter = content.slice(3, closeStart).trim();
    const body = content.slice(closeStart + closeMatch[0].length).trim();

    return [frontmatter, body];
}
