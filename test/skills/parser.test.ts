import * as v from 'valibot';
import { describe, expect, it, test } from 'vitest';
import {
    defineSkill,
    formatSkillCatalog,
    ParseError,
    parseSkill,
    SkillMetadataSchema,
    stringifySkill,
    ValidationError,
} from '../../lib/index.ts';

const validSkillMd = `---
name: appointment-management
description: Protocolos detallados para agendamiento, consulta y cancelación de citas médicas.
license: MIT
compatibility: requires quiron-api
allowed-tools: identificar-paciente agendar-cita
metadata:
  author: escano-dev
  department: radiology
---

# Gestión de citas médicas

1. Identifica al paciente.
2. Busca los profesionales disponibles.

---

Recordatorio: Solicitar documento físico.
`;

describe('SkillMetadataSchema', () => {
    it('accepts valid metadata with all fields', () => {
        const input = {
            name: 'appointment-management',
            description: 'Handles clinic appointment flows.',
            license: 'MIT',
            compatibility: 'Node 20+',
            'allowed-tools': 'fetch-patient book-slot',
            metadata: { author: 'escano', version: '1.0' },
        };
        const output = v.parse(SkillMetadataSchema, input);
        expect(output).toEqual(input);
    });

    it('accepts minimal metadata with only name and description', () => {
        const input = {
            name: 'booking',
            description: 'Minimal skill description.',
        };
        expect(v.parse(SkillMetadataSchema, input)).toEqual({
            name: 'booking',
            description: 'Minimal skill description.',
            metadata: {},
        });
    });

    test.each(['Booking', 'book_slot', '-leading', 'trailing-', 'double--dash', '', 'a'.repeat(65)])(
        'rejects invalid name %p',
        (name) => {
            const result = v.safeParse(SkillMetadataSchema, { name, description: 'Valid description.' });
            expect(result.success).toBe(false);
        },
    );

    it('rejects empty description or description exceeding 1024 chars', () => {
        expect(v.safeParse(SkillMetadataSchema, { name: 'valid', description: '' }).success).toBe(false);
        expect(v.safeParse(SkillMetadataSchema, { name: 'valid', description: 'x'.repeat(1025) }).success).toBe(false);
    });

    it('rejects compatibility exceeding 500 chars', () => {
        const result = v.safeParse(SkillMetadataSchema, {
            name: 'valid',
            description: 'Valid description.',
            compatibility: 'x'.repeat(501),
        });
        expect(result.success).toBe(false);
    });

    it('rejects non-string values inside metadata record', () => {
        const result = v.safeParse(SkillMetadataSchema, {
            name: 'valid',
            description: 'Valid description.',
            metadata: { count: 123 }, // must be string-to-string per agentskills.io
        });
        expect(result.success).toBe(false);
    });

    it('preserves unrecognized fields (looseObject for forward compatibility)', () => {
        const output = v.parse(SkillMetadataSchema, {
            name: 'valid-skill',
            description: 'Valid description.',
            experimentalFlag: true,
        }) as Record<string, unknown>;
        expect(output.experimentalFlag).toBe(true);
    });
});

describe('parseSkill', () => {
    it('parses full valid SKILL.md document', () => {
        const { metadata, instructions } = parseSkill(validSkillMd);

        expect(metadata.name).toBe('appointment-management');
        expect(metadata.description).toContain('Protocolos detallados');
        expect(metadata.license).toBe('MIT');
        expect(metadata.compatibility).toBe('requires quiron-api');
        expect(metadata['allowed-tools']).toBe('identificar-paciente agendar-cita');
        expect(metadata.metadata?.department).toBe('radiology');

        // Preserves internal markdown horizontal rules ('---')
        expect(instructions).toContain('# Gestión de citas médicas');
        expect(instructions).toContain('---\n\nRecordatorio: Solicitar documento físico.');
    });

    it('parses SKILL.md with empty instructions body', () => {
        const raw = `---
name: minimal-skill
description: Does one thing.
---`;
        const { metadata, instructions } = parseSkill(raw);
        expect(metadata.name).toBe('minimal-skill');
        expect(instructions).toBe('');
    });

    it('handles Windows CRLF line endings cleanly', () => {
        const crlf = '---\r\nname: crlf-skill\r\ndescription: CRLF test.\r\n---\r\n\r\nBody here.';
        const { metadata, instructions } = parseSkill(crlf);
        expect(metadata.name).toBe('crlf-skill');
        expect(instructions).toBe('Body here.');
    });

    it('rejects document without opening delimiter', () => {
        expect(() => parseSkill('name: missing-delimiters\ndescription: test\n')).toThrow(ParseError);
    });

    it('rejects document without closing delimiter', () => {
        const raw = `---
name: unclosed
description: test
`;
        expect(() => parseSkill(raw)).toThrow(ParseError);
    });

    it('rejects malformed YAML syntax with ParseError', () => {
        const raw = `---
name: broken
description: [unclosed yaml
---
Body`;
        expect(() => parseSkill(raw)).toThrow(ParseError);
    });

    it('rejects metadata validation failure with ValidationError', () => {
        const raw = `---
name: INVALID_NAME
description: test
---
Body`;
        expect(() => parseSkill(raw)).toThrow(ValidationError);
    });

    it('round-trips serialization with stringifySkill', () => {
        const parsed = parseSkill(validSkillMd);
        const serialized = stringifySkill(parsed.metadata, parsed.instructions);
        const reparsed = parseSkill(serialized);

        expect(reparsed.metadata).toEqual(parsed.metadata);
        expect(reparsed.instructions).toEqual(parsed.instructions);
    });
});

describe('defineSkill & formatSkillCatalog', () => {
    it('defineSkill validates and returns typed skill structure', () => {
        const skill = defineSkill(
            { name: 'author-test', description: 'Authored in TS.' },
            '# Instructions\nExecute now.',
        );

        expect(skill.metadata.name).toBe('author-test');
        expect(skill.instructions).toBe('# Instructions\nExecute now.');
    });

    it('defineSkill throws on invalid input', () => {
        expect(() => defineSkill({ name: 'BAD NAME', description: 'Invalid.' }, 'Body')).toThrow();
    });

    it('formatSkillCatalog outputs valid XML catalog', () => {
        const xml = formatSkillCatalog([
            { name: 'booking', description: 'Book appointments.' },
            { name: 'billing', description: 'Process invoices.' },
        ]);

        expect(xml).toContain('<available_skills>');
        expect(xml).toContain('<skill name="booking">\n    Book appointments.\n  </skill>');
        expect(xml).toContain('<skill name="billing">\n    Process invoices.\n  </skill>');
        expect(xml).toContain('</available_skills>');
    });

    it('formatSkillCatalog returns empty string for empty array', () => {
        expect(formatSkillCatalog([])).toBe('');
    });
});
