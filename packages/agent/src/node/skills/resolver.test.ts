import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParseError } from '../../errors';
import { createFsResolver } from './resolver';

function toText(bytes: string | Uint8Array): string {
    return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
}

function toBytes(bytes: string | Uint8Array): Uint8Array {
    return typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
    return promise.catch((error: unknown) => error);
}

describe('Filesystem Resolver (createFsResolver)', () => {
    let tempDir: string;
    let skillDir: string;
    let siblingDir: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'ekisa-resolver-test-'));
        skillDir = join(tempDir, 'skill');
        siblingDir = join(tempDir, 'skill-evil');

        await mkdir(join(skillDir, 'references', 'policies'), { recursive: true });
        await mkdir(join(skillDir, 'assets'), { recursive: true });
        await mkdir(join(skillDir, 'scripts'), { recursive: true });

        await writeFile(join(skillDir, 'references', 'policy.md'), '# Policy\n24h required.');
        await writeFile(join(skillDir, 'references', 'policies', 'nested.md'), 'nested policy');
        await writeFile(join(skillDir, 'assets', 'template.json'), '{"ok":true}');
        await writeFile(join(skillDir, 'assets', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        await writeFile(join(skillDir, 'SKILL.md'), '---\nname: x\ndescription: x\n---\n');

        await mkdir(siblingDir, { recursive: true });
        await writeFile(join(siblingDir, 'secret.txt'), 'leaked');
    });

    afterAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe('read()', () => {
        test('reads a markdown file', async () => {
            const resolver = createFsResolver(skillDir);
            const bytes = await resolver.read('references/policy.md');
            expect(toText(bytes)).toContain('24h required');
        });

        test('reads a nested file', async () => {
            const resolver = createFsResolver(skillDir);
            const bytes = await resolver.read('references/policies/nested.md');
            expect(toText(bytes)).toBe('nested policy');
        });

        test('preserves binary content as raw bytes', async () => {
            const resolver = createFsResolver(skillDir);
            const bytes = await resolver.read('assets/icon.png');
            expect(Array.from(toBytes(bytes))).toEqual([0x89, 0x50, 0x4e, 0x47]);
        });

        test('rejects relative traversal out of root (../)', async () => {
            const resolver = createFsResolver(skillDir);
            const error = await captureError(resolver.read('../secret.txt'));
            expect(error).toBeInstanceOf(ParseError);
        });

        test('rejects absolute paths', async () => {
            const resolver = createFsResolver(skillDir);
            const error = await captureError(resolver.read('/etc/passwd'));
            expect(error).toBeInstanceOf(ParseError);
        });

        test('rejects sibling directory whose path shares the root prefix', async () => {
            const resolver = createFsResolver(skillDir);
            const error = await captureError(resolver.read('../skill-evil/secret.txt'));
            expect(error).toBeInstanceOf(ParseError);
        });
    });

    describe('list()', () => {
        test('returns files from references/, assets/, and scripts/', async () => {
            const resolver = createFsResolver(skillDir);
            const files = await resolver.list();
            expect(files.toSorted()).toEqual([
                'assets/icon.png',
                'assets/template.json',
                'references/policies/nested.md',
                'references/policy.md',
            ]);
        });

        test('recurses into nested folders', async () => {
            const resolver = createFsResolver(skillDir);
            const files = await resolver.list();
            expect(files).toContain('references/policies/nested.md');
        });

        test('ignores files outside the known folders', async () => {
            const resolver = createFsResolver(skillDir);
            const files = await resolver.list();
            expect(files).not.toContain('SKILL.md');
        });

        test('returns only files, not directories', async () => {
            const resolver = createFsResolver(skillDir);
            const files = await resolver.list();
            expect(files).not.toContain('references/policies');
        });

        test('returns an empty array when no known folder exists', async () => {
            const emptyDir = join(tempDir, 'empty-skill');
            await mkdir(emptyDir, { recursive: true });
            const resolver = createFsResolver(emptyDir);
            expect(await resolver.list()).toEqual([]);
        });
    });
});
