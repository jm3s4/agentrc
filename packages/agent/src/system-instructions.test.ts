import { describe, expect, it } from 'bun:test';
import type { AgentDocument } from './spec';
import { buildSystemInstructions, formatTemporalContext } from './system-instructions';

const locale = {
    language: 'en-US',
    timeZone: 'America/Bogota',
};

function createDocument(instructions = '# Agent instructions'): AgentDocument {
    return {
        instructions,
        manifest: {
            spec: {
                locale,
            },
        },
    } as AgentDocument;
}

describe('formatTemporalContext', () => {
    it('formats the date using the configured timezone and ISO format', () => {
        // 02:00 UTC is still November 10 in Bogota
        const result = formatTemporalContext(locale, {
            now: new Date('2026-11-11T02:00:00.000Z'),
        });

        expect(result).toBe(
            [
                '## Temporal context',
                '- Time zone: America/Bogota',
                '- Current date: Tuesday, November 10, 2026 (ISO: 2026-11-10)',
            ].join('\n'),
        );
    });
});

describe('buildSystemInstructions', () => {
    it('separates static instructions, dynamic instructions, and reference context', () => {
        const result = buildSystemInstructions(createDocument('  # Agent instructions  '), {
            temporal: false,
            variables: {
                environment: 'production',
            },
            additionalInstructions: 'Follow the application-specific rules.',
            referenceContext: 'Retrieved documentation.',
        });

        expect(result).toEqual({
            staticInstructions: '# Agent instructions',
            dynamicInstructions: [
                '## Runtime variables',
                '- environment: production',
                '',
                'Follow the application-specific rules.',
            ].join('\n'),
            referenceContext: ['Retrieved documentation.'],
        });
    });

    it('formats dynamic sections in the expected order', () => {
        const result = buildSystemInstructions(createDocument(), {
            variables: {
                userId: '123',
            },
            additionalInstructions: 'Additional application instructions.',
            referenceContext: 'Reference document.',
            now: new Date('2026-11-11T12:00:00.000Z'),
        });

        const dynamic = result.dynamicInstructions;

        const variableIndex = dynamic.indexOf('## Runtime variables');
        const temporalIndex = dynamic.indexOf('## Temporal context');
        const additionalIndex = dynamic.indexOf('Additional application instructions.');

        expect(variableIndex).toBeGreaterThanOrEqual(0);
        expect(temporalIndex).toBeGreaterThan(variableIndex);
        expect(additionalIndex).toBeGreaterThan(temporalIndex);

        expect(result.referenceContext).toEqual(['Reference document.']);
    });

    it('normalizes variables and additional instructions', () => {
        const result = buildSystemInstructions(createDocument(), {
            temporal: false,
            variables: {
                zeta: 'last\nline',
                alpha: 'first\r\nsecond',
                '  ': 'ignored',
            },
            additionalInstructions: [' First block ', '', '   ', 'Second block\n\n'],
        });

        expect(result.dynamicInstructions).toBe(
            [
                '## Runtime variables',
                '- alpha: first second',
                '- zeta: last line',
                '',
                'First block',
                '',
                'Second block',
            ].join('\n'),
        );
    });

    it('returns empty sections when no optional content is provided', () => {
        const result = buildSystemInstructions(createDocument('   '), {
            temporal: false,
        });

        expect(result).toEqual({
            staticInstructions: '',
            dynamicInstructions: '',
            referenceContext: [],
        });
    });
});
