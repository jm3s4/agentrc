import { describe, expect, test } from 'vitest';
import { ParseError } from '../lib/errors.ts';
import { MemoryFileSystem, normalizePath, scopeFileSystem } from '../lib/filesystem.ts';

describe('normalizePath', () => {
    test('normalizes relative prefixes and dot segments', () => {
        expect(normalizePath('./tools/lookup.yaml')).toBe('tools/lookup.yaml');
        expect(normalizePath('references/./v1..v2.md')).toBe('references/v1..v2.md');
        expect(normalizePath('.', true)).toBe('');
    });

    test.each(['', '.', '../secret.txt', '/etc/passwd', '\\win\\sys', 'C:\\file.txt', 'a/../../b'])(
        'rejects unsafe or empty path %p',
        (badPath) => {
            expect(() => normalizePath(badPath)).toThrow(ParseError);
        },
    );
});

describe('MemoryFileSystem & scopeFileSystem', () => {
    const fs = new MemoryFileSystem({
        './AGENT.md': 'root',
        'skills/triage/SKILL.md': 'triage',
        'skills/triage/references/matrix.md': 'matrix',
        'skills/triage-extra/SKILL.md': 'other',
    });

    test('reads normalized keys and lists by directory prefix', async () => {
        expect(await fs.read('./AGENT.md')).toBe('root');
        expect(await fs.list('skills/triage')).toEqual([
            'skills/triage/SKILL.md',
            'skills/triage/references/matrix.md',
        ]);
        await expect(fs.read('missing.md')).rejects.toThrow(ParseError);
    });

    test('scopeFileSystem isolates reads and strips prefix from list', async () => {
        const scoped = scopeFileSystem(fs, './skills/triage');

        expect(await scoped.read('references/matrix.md')).toBe('matrix');
        expect(await scoped.list()).toEqual(['SKILL.md', 'references/matrix.md']);
    });
});
