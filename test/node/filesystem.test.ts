import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Agent } from '../../lib/agent.ts';
import { ParseError } from '../../lib/errors.ts';
import { NodeFileSystem } from '../../lib/node/index.ts';
import { Skill } from '../../lib/skill.ts';

describe('NodeFileSystem', () => {
    let tempDir: string;
    let agentDir: string;
    let siblingDir: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'agent-node-test-'));
        agentDir = join(tempDir, 'agent');
        siblingDir = join(tempDir, 'agent-evil');

        await mkdir(join(agentDir, 'tools'), { recursive: true });
        await mkdir(join(agentDir, 'skills', 'triage', 'references'), { recursive: true });
        await mkdir(siblingDir, { recursive: true });

        await writeFile(join(siblingDir, 'secret.txt'), 'leaked');
        await writeFile(
            join(agentDir, 'AGENT.md'),
            '---\nname: local-bot\nversion: 1.0.0\nmodel:\n  id: gpt-4o\ntools:\n  - ./tools/ping.yaml\nskills:\n  - ./skills/triage\n---\nLocal prompt.',
        );
        await writeFile(
            join(agentDir, 'tools', 'ping.yaml'),
            'name: ping\ndescription: Pings a target.\ninputSchema: {}',
        );
        await writeFile(
            join(agentDir, 'skills', 'triage', 'SKILL.md'),
            '---\nname: triage\ndescription: Triage work.\n---\nGuide',
        );
        await writeFile(join(agentDir, 'skills', 'triage', 'references', 'policy.md'), '24h required');
        await symlink(join(siblingDir, 'secret.txt'), join(agentDir, 'skills', 'triage', 'references', 'leak.txt'));
    });

    afterAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    test('loads Agent and Skills from disk and excludes symlinks from listings', async () => {
        const fs = new NodeFileSystem(agentDir);
        const agent = await Agent.load(fs);

        expect(agent.name).toBe('local-bot');
        expect(agent.getTool('ping')?.name).toBe('ping');

        const skill = agent.getSkill('triage')!;
        expect(await skill.listResources()).toEqual([
            { path: 'references/policy.md', name: 'policy.md', mediaType: 'text/markdown' },
        ]);
        expect(await (await skill.getResource('references/policy.md')).text()).toBe('24h required');

        const discovered = await Skill.discover(new NodeFileSystem(join(agentDir, 'skills')));
        expect(discovered).toEqual([{ name: 'triage', description: 'Triage work.', path: 'triage' }]);
    });

    test.each(['../agent-evil/secret.txt', '/etc/passwd', 'skills/triage/references/leak.txt'])(
        'blocks traversal and symlink escapes for %p',
        async (badPath) => {
            const fs = new NodeFileSystem(agentDir);
            await expect(fs.read(badPath)).rejects.toThrow(ParseError);
        },
    );

    test('returns empty list when root directory does not exist', async () => {
        const fs = new NodeFileSystem(join(tempDir, 'does-not-exist'));
        expect(await fs.list()).toEqual([]);
    });
});
