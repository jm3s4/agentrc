import { describe, expect, test } from 'bun:test';
import { ParseError } from '../errors';
import { createSkill } from './skill';

describe('createSkill', () => {
    test('creates skill with minimal metadata (omitting optional metadata field)', () => {
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

    test('creates skill with full metadata', () => {
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

    test('throws immediately if metadata fails schema validation', () => {
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

    test('skills without resolvers return empty resource lists and throw on read', async () => {
        const skill = createSkill({
            metadata: { name: 'prompt-only', description: 'Has no files.' },
            instructions: 'Instructions',
        });

        expect(await skill.listResources()).toEqual([]);
        expect(skill.resource('references/file.md')).rejects.toThrow(ParseError);
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

        expect(skill.resource(badPath)).rejects.toThrow(ParseError);
    });

    test('infers media types correctly across common extensions', async () => {
        const files: Record<string, string> = {
            'references/guide.md': '# Guide',
            'references/data.json': '{"foo": "bar"}',
            'references/table.csv': 'col1,col2',
            'assets/icon.svg': '<svg></svg>',
            'assets/logo.png': 'png-data',
            'scripts/run.py': 'print("hello")',
            'references/unknown.custom': 'raw data',
        };

        const skill = createSkill({
            metadata: { name: 'mime-skill', description: 'Tests MIME types.' },
            instructions: 'test',
            resolver: {
                read: async (path) => files[path] ?? '',
                list: async () => Object.keys(files),
            },
        });

        const resources = await skill.listResources();
        expect(resources).toHaveLength(7);

        const md = await skill.resource('references/guide.md');
        expect(md.mediaType).toBe('text/markdown');
        expect(await md.text()).toBe('# Guide');

        const json = await skill.resource('references/data.json');
        expect(json.mediaType).toBe('application/json');

        const py = await skill.resource('scripts/run.py');
        expect(py.mediaType).toBe('text/x-python');

        const unknown = await skill.resource('references/unknown.custom');
        expect(unknown.mediaType).toBe('application/octet-stream');
    });

    test('seamlessly converts text() and bytes() regardless of resolver return type', async () => {
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
