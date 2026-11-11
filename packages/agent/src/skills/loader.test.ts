import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParseError } from '../errors';
import { createMemoryResolver, discoverSkills, loadSkill } from './loader';
import { createSkill } from './skill';

describe('createSkill (Storage-Agnostic Core)', () => {
    test('instantiates prompt-only skill when resolver is omitted', async () => {
        const skill = createSkill({
            metadata: { name: 'prompt-only', description: 'No external files.' },
            instructions: 'You are an advisor.',
        });

        expect(skill.name).toBe('prompt-only');
        expect(skill.instructions).toBe('You are an advisor.');
        expect(await skill.listResources()).toEqual([]);
        expect(skill.resource('anything.md')).rejects.toThrow(ParseError);
    });

    test.each(['../secret.txt', '../../etc/passwd', '/etc/passwd', 'references/../../escaped'])(
        'blocks path traversal attack %p with ParseError',
        async (badPath) => {
            const skill = createSkill({
                metadata: { name: 'secure-skill', description: 'Security test.' },
                instructions: 'test',
                resolver: {
                    read: async () => 'secret data',
                    list: async () => [],
                },
            });

            expect(skill.resource(badPath)).rejects.toThrow(ParseError);
        },
    );

    test('infers correct media types for resources', async () => {
        const mockFiles: Record<string, string> = {
            'references/guide.md': '# Guide',
            'references/data.json': '{"key": "val"}',
            'assets/template.csv': 'a,b,c',
            'assets/icon.svg': '<svg></svg>',
            'references/unknown.xyz': 'raw bytes',
        };

        const skill = createSkill({
            metadata: { name: 'mime-skill', description: 'MIME test.' },
            instructions: 'test',
            resolver: {
                read: async (p) => mockFiles[p] ?? '',
                list: async () => Object.keys(mockFiles),
            },
        });

        const list = await skill.listResources();
        expect(list).toHaveLength(5);

        const mdRes = await skill.resource('references/guide.md');
        expect(mdRes.mediaType).toBe('text/markdown');
        expect(await mdRes.text()).toBe('# Guide');

        const jsonRes = await skill.resource('references/data.json');
        expect(jsonRes.mediaType).toBe('application/json');

        const csvRes = await skill.resource('assets/template.csv');
        expect(csvRes.mediaType).toBe('text/csv');

        const unknownRes = await skill.resource('references/unknown.xyz');
        expect(unknownRes.mediaType).toBe('application/octet-stream');
    });

    test('resource text() and bytes() methods convert seamlessly', async () => {
        const skill = createSkill({
            metadata: { name: 'buffer-test', description: 'Buffer test.' },
            instructions: 'test',
            resolver: {
                // Returns raw binary Uint8Array
                read: async () => new TextEncoder().encode('Hello binary world'),
                list: async () => ['references/file.txt'],
            },
        });

        const res = await skill.resource('references/file.txt');
        expect(await res.text()).toBe('Hello binary world');
        expect(await res.bytes()).toEqual(new TextEncoder().encode('Hello binary world'));
    });
});

describe('createMemoryResolver (OCI / Virtual Bundles)', () => {
    test('resolves files from virtual Map with directory prefix', async () => {
        const virtualFiles = new Map<string, string | Uint8Array>([
            ['skills/triage/SKILL.md', '---\nname: triage\ndescription: Triage queries.\n---\nBody'],
            ['skills/triage/references/priority.md', '# Priority Matrix\nLevel 1: Urgent'],
            ['skills/triage/assets/form.json', '{"status": "new"}'],
            ['other-file.txt', 'unrelated'],
        ]);

        const resolver = createMemoryResolver(virtualFiles, 'skills/triage');

        const available = await resolver.list();
        expect(available).toEqual(['references/priority.md', 'assets/form.json']);

        const content = await resolver.read('references/priority.md');
        expect(content).toContain('Level 1: Urgent');

        expect(resolver.read('references/missing.md')).rejects.toThrow(ParseError);
    });
});

describe('Filesystem Loader (loadSkill & discoverSkills)', () => {
    let tempDir: string;
    let skillDirA: string;
    let skillDirB: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'ekisa-skills-test-'));

        // Skill A: Full skill with references and assets
        skillDirA = join(tempDir, 'appointment-management');
        await mkdir(join(skillDirA, 'references'), { recursive: true });
        await mkdir(join(skillDirA, 'assets'), { recursive: true });

        await writeFile(
            join(skillDirA, 'SKILL.md'),
            `---
name: appointment-management
description: Manage patient appointments.
---
# Instructions
Follow clinic rules.`,
        );
        await writeFile(join(skillDirA, 'references', 'cancellation.md'), '# Cancellation Policy\n24 hours required.');
        await writeFile(join(skillDirA, 'assets', 'template.json'), '{"confirmed": true}');

        // Skill B: Minimal skill without extra folders
        skillDirB = join(tempDir, 'patient-guidance');
        await mkdir(skillDirB, { recursive: true });
        await writeFile(
            join(skillDirB, 'SKILL.md'),
            `---
name: patient-guidance
description: Guidance on test preparation.
---
# Fasting Rules
8 hours fasting.`,
        );

        // Dummy folder without SKILL.md (should be ignored by discoverSkills)
        await mkdir(join(tempDir, 'not-a-skill'), { recursive: true });
        await writeFile(join(tempDir, 'not-a-skill', 'readme.txt'), 'ignore me');
    });

    afterAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    test('loadSkill reads real directory and mounts filesystem resources', async () => {
        const skill = await loadSkill(skillDirA);

        expect(skill.name).toBe('appointment-management');
        expect(skill.instructions).toContain('Follow clinic rules.');

        const resources = await skill.listResources();
        expect(resources).toHaveLength(2);
        expect(resources.map((r) => r.path).toSorted()).toEqual(['assets/template.json', 'references/cancellation.md']);

        const policyRes = await skill.resource('references/cancellation.md');
        expect(await policyRes.text()).toContain('24 hours required.');
        expect(policyRes.mediaType).toBe('text/markdown');
    });

    test('loadSkill throws ParseError when SKILL.md is missing', async () => {
        expect(loadSkill(join(tempDir, 'not-a-skill'))).rejects.toThrow(ParseError);
    });

    test('discoverSkills finds all valid skills and ignores non-skill directories', async () => {
        const discovered = await discoverSkills(tempDir);

        expect(discovered).toHaveLength(2);
        const names = discovered.map((d) => d.name).toSorted();
        expect(names).toEqual(['appointment-management', 'patient-guidance']);
    });
});
