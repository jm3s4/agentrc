import { describe, expect, test } from 'vitest';
import { ParseError, ValidationError } from '../lib/errors.ts';
import { MemoryFileSystem } from '../lib/filesystem.ts';
import { Skill } from '../lib/skill.ts';

const skillMd = `---
name: triage
description: Classify incoming tickets.
metadata:
  team: support
---
Check outage status first.
`;

describe('Skill', () => {
    test('constructs from SKILL.md or object and round-trips toJSON / toString', () => {
        const fromMd = new Skill(skillMd);
        const fromJson = new Skill(fromMd.toJSON());
        const reparsed = new Skill(fromMd.toString());

        expect(fromMd.name).toBe('triage');
        expect(fromMd.instructions).toBe('Check outage status first.');
        expect(fromJson.toJSON()).toEqual(fromMd.toJSON());
        expect(reparsed.toJSON()).toEqual(fromMd.toJSON());
    });

    test('rejects invalid skill metadata', () => {
        expect(() => new Skill({ name: 'BAD', description: 'x' })).toThrow(ValidationError);
        expect(() => new Skill('---\nname: [broken')).toThrow(ParseError);
    });

    test('loads resources lazily, infers MIME types, and blocks traversal', async () => {
        const fs = new MemoryFileSystem({
            'skills/triage/SKILL.md': skillMd,
            'skills/triage/references/v1..v2.md': '# Diff',
            'skills/triage/assets/form.json': '{"ok":true}',
        });

        const skill = await Skill.load(fs, 'skills/triage');
        const resources = await skill.listResources();

        expect(resources).toEqual([
            { path: 'assets/form.json', name: 'form.json', mediaType: 'application/json' },
            { path: 'references/v1..v2.md', name: 'v1..v2.md', mediaType: 'text/markdown' },
        ]);

        const diff = await skill.getResource('references/v1..v2.md');
        expect(await diff.text()).toBe('# Diff');
        expect(new TextDecoder().decode(await diff.bytes())).toBe('# Diff');

        await expect(skill.getResource('../secret.txt')).rejects.toThrow(ParseError);
    });

    test('discovers skills and escapes XML in catalog', async () => {
        const fs = new MemoryFileSystem({
            'skills/triage/SKILL.md': '---\nname: triage\ndescription: Handle <urgent> & "VIP" cases.\n---\nBody',
            'skills/billing/SKILL.md': '---\nname: billing\ndescription: Process refunds.\n---\nBody',
            'skills/notes/readme.txt': 'ignored',
        });

        const summaries = await Skill.discover(fs, 'skills');
        expect(summaries).toEqual([
            { name: 'billing', description: 'Process refunds.', path: 'billing' },
            { name: 'triage', description: 'Handle <urgent> & "VIP" cases.', path: 'triage' },
        ]);

        expect(Skill.formatCatalog(summaries)).toMatchInlineSnapshot(`
          "<available_skills>
            <skill name="billing">
              Process refunds.
            </skill>
            <skill name="triage">
              Handle &lt;urgent&gt; &amp; &quot;VIP&quot; cases.
            </skill>
          </available_skills>"
        `);
    });
});
