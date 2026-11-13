import { describe, expect, test } from 'vitest';
import { Agent } from '../lib/agent.ts';
import { ParseError, ValidationError } from '../lib/errors.ts';
import { MemoryFileSystem } from '../lib/filesystem.ts';

const agentMd = `---
name: support-bot
version: 1.0.0
locale:
  language: en-US
  timeZone: America/Bogota
model:
  id: gpt-4o
  reasoningEffort: xhigh
skills:
  - ./skills/triage
tools:
  - ./tools/lookup.yaml
  - name: echo
    description: Echoes input text cleanly.
    inputSchema:
      type: object
      required: [text]
      properties:
        text:
          type: string
---
You are helpful.
`;

describe('Agent', () => {
    test('constructs from AGENT.md or object and round-trips toJSON / toString', () => {
        const fromMd = new Agent(agentMd);
        const fromJson = new Agent(fromMd.toJSON());
        const reparsed = new Agent(fromMd.toString());

        expect(fromMd.name).toBe('support-bot');
        expect(fromMd.model.reasoningEffort).toBe('xhigh');
        expect(fromMd.getTool('echo')?.name).toBe('echo');
        expect(fromJson.toJSON()).toEqual(fromMd.toJSON());
        expect(reparsed.toJSON()).toEqual(fromMd.toJSON());
    });

    test('validates schema including IANA timeZone and defaults isolation', () => {
        expect(
            () => new Agent({ name: 'a', version: '1.0.0', model: { id: 'x' }, locale: { timeZone: 'Mars/Olympus' } }),
        ).toThrow(ValidationError);

        const a = new Agent({ name: 'a', version: '1.0.0', model: { id: 'x' } });
        const b = new Agent({ name: 'b', version: '1.0.0', model: { id: 'x' } });
        a.manifest.tags.push('only-a');
        expect(b.tags).toEqual([]);
    });

    test('loads tools and skills from FileSystem and supports per-tenant configure()', async () => {
        const mockFetch = (async (_url: unknown, init?: RequestInit) =>
            new Response(JSON.stringify({ auth: new Headers(init?.headers).get('Authorization') }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })) as unknown as typeof fetch;

        const fs = new MemoryFileSystem({
            'AGENT.md': agentMd,
            'tools/lookup.yaml': `
name: lookup
description: Looks up account details.
inputSchema:
  type: object
execution:
  type: http
  method: GET
  url: https://api.example.com/me
  headers:
    Authorization: Bearer {{secret.API_KEY}}
`,
            'skills/triage/SKILL.md': '---\nname: triage\ndescription: Triage tickets.\n---\nStep 1',
            'skills/triage/references/rules.md': 'Rule A',
        });

        const base = await Agent.load(fs, { fetch: mockFetch });
        const tenantA = base.configure({ secrets: { API_KEY: 'key-a' } });
        const tenantB = base.configure({ secrets: { API_KEY: 'key-b' } });

        await expect(base.getTool('lookup')!.execute({})).rejects.toThrow(ParseError);
        expect(await tenantA.getTool('lookup')!.execute({})).toEqual({ auth: 'Bearer key-a' });
        expect(await tenantB.getTool('lookup')!.execute({})).toEqual({ auth: 'Bearer key-b' });
        expect(await (await tenantA.getSkill('triage')!.getResource('references/rules.md')).text()).toBe('Rule A');
    });

    test('propagates real ValidationError from malformed referenced tool files', async () => {
        const fs = new MemoryFileSystem({
            'AGENT.md': '---\nname: a\nversion: 1.0.0\nmodel:\n  id: x\ntools:\n  - ./tools/bad.yaml\n---\nHi',
            'tools/bad.yaml': 'name: BAD_NAME\ndescription: short\ninputSchema: {}',
        });

        await expect(Agent.load(fs)).rejects.toThrow(ValidationError);
    });

    test('builds static and dynamic instructions deterministically', async () => {
        const fs = new MemoryFileSystem({
            'AGENT.md': agentMd,
            'tools/lookup.yaml': 'name: lookup\ndescription: Looks up records.\ninputSchema: {}',
            'skills/triage/SKILL.md': '---\nname: triage\ndescription: Triage tickets.\n---\nBody',
        });

        const agent = await Agent.load(fs);
        const built = agent.buildInstructions({
            variables: { zeta: 'last\nline', env: 'prod', ' ': 'ignored' },
            additionalInstructions: 'Be brief.',
            now: new Date('2026-11-11T02:00:00.000Z'),
        });

        expect(built.toString()).toMatchInlineSnapshot(`
          "You are helpful.

          <available_skills>
            <skill name="triage">
              Triage tickets.
            </skill>
          </available_skills>

          ## Runtime variables
          - env: prod
          - zeta: last line

          ## Temporal context
          - Time zone: America/Bogota
          - Current date: Tuesday, November 10, 2026 (ISO: 2026-11-10)

          Be brief."
        `);
    });
});
