import { describe, expect, it } from 'bun:test';
import { ParseError } from '../errors';
import { createMemoryResolver } from './resolver';

describe('createMemoryResolver (OCI / Virtual Bundles)', () => {
    it('resolves files from virtual Map with directory prefix', async () => {
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
