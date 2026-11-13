import { describe, expect, it, test } from 'vitest';
import { createSkill, ParseError } from '../../lib/index.ts';

describe('createSkill', () => {
    it('creates skill with minimal metadata (omitting optional metadata field)', () => {
        const skill = createSkill({
            metadata: {
                name: 'minimal-skill',
                description: 'A skill with only name and description.',
            },
            instructions: '# Instructions',
        });

        expect(skill.name).toBe('minimal-skill');
        expect(skill.description).toBe('A skill with only name and description.');
        expect(skill.instructions).toBe('# Instructions');
        // Verifies the default {} was resolved in the output
        expect(skill.metadata.metadata).toEqual({});
    });

    it('creates skill with full metadata', () => {
        const skill = createSkill({
            metadata: {
                name: 'full-skill',
                description: 'Complete skill.',
                license: 'MIT',
                compatibility: 'Node 20+',
                'allowed-tools': 'tool-a tool-b',
                metadata: { key: 'value' },
            },
            instructions: 'Instructions here',
        });

        expect(skill.metadata.license).toBe('MIT');
        expect(skill.metadata['allowed-tools']).toBe('tool-a tool-b');
        expect(skill.metadata.metadata).toEqual({ key: 'value' });
    });

    it('throws immediately if metadata fails schema validation', () => {
        expect(() =>
            createSkill({
                metadata: {
                    name: 'INVALID_UPPERCASE',
                    description: 'Valid description.',
                },
                instructions: 'Instructions',
            }),
        ).toThrow();
    });

    it('skills without resolvers return empty resource lists and throw on read', async () => {
        const skill = createSkill({
            metadata: { name: 'prompt-only', description: 'Has no files.' },
            instructions: 'Instructions',
        });

        expect(await skill.listResources()).toEqual([]);
        await expect(skill.resource('references/file.md')).rejects.toThrow(ParseError);
    });

    test.each([
        '../secret.txt',
        '../../etc/passwd',
        '/etc/passwd',
        '\\windows\\system32',
        'references/../../escaped.txt',
    ])('blocks path traversal attempt %p with ParseError', async (badPath) => {
        const skill = createSkill({
            metadata: { name: 'secure-skill', description: 'Security test.' },
            instructions: 'test',
            resolver: {
                read: async () => 'secret data',
                list: async () => ['secret.txt'],
            },
        });

        await expect(skill.resource(badPath)).rejects.toThrow(ParseError);
    });

    it('infers media types correctly across common extensions', async () => {
        const expected: Record<string, [content: string, mediaType: string]> = {
            'references/guide.md': ['# Guide', 'text/markdown'],
            'references/data.json': ['{"foo": "bar"}', 'application/json'],
            'references/table.csv': ['col1,col2', 'text/csv'],
            'assets/icon.svg': ['<svg></svg>', 'image/svg+xml'],
            'assets/logo.png': ['png-data', 'image/png'],
            'scripts/run.py': ['print("hello")', 'text/x-python'],
            'references/unknown.custom': ['raw data', 'application/octet-stream'],
        };

        const skill = createSkill({
            metadata: { name: 'mime-skill', description: 'Tests MIME types.' },
            instructions: 'test',
            resolver: {
                read: async (path) => expected[path]?.[0] ?? '',
                list: async () => Object.keys(expected),
            },
        });

        const resources = await skill.listResources();
        expect(resources).toHaveLength(Object.keys(expected).length);

        for (const [path, [content, mediaType]] of Object.entries(expected)) {
            const res = await skill.resource(path);
            expect(res.mediaType).toBe(mediaType);
            expect(await res.text()).toBe(content);
        }
    });

    it('seamlessly converts text() and bytes() regardless of resolver return type', async () => {
        const encoder = new TextEncoder();
        const binaryData = encoder.encode('Raw binary bytes');

        const skill = createSkill({
            metadata: { name: 'conversion-test', description: 'Testing conversions.' },
            instructions: 'test',
            resolver: {
                read: async () => binaryData,
                list: async () => ['file.bin'],
            },
        });

        const res = await skill.resource('file.bin');
        expect(await res.text()).toBe('Raw binary bytes');
        expect(await res.bytes()).toEqual(binaryData);
    });
});
