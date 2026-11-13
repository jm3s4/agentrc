import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParseError } from '../../../lib/index.ts';
import { discoverSkills, loadSkill } from '../../../lib/node/index.ts';

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

    it('loadSkill reads real directory and mounts filesystem resources', async () => {
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

    it('loadSkill throws ParseError when SKILL.md is missing', async () => {
        await expect(loadSkill(join(tempDir, 'not-a-skill'))).rejects.toThrow(ParseError);
    });

    it('discoverSkills finds all valid skills and ignores non-skill directories', async () => {
        const discovered = await discoverSkills(tempDir);

        expect(discovered).toHaveLength(2);
        const names = discovered.map((d) => d.name).toSorted();
        expect(names).toEqual(['appointment-management', 'patient-guidance']);
    });
});
