import { formatSkillCatalog, type SkillSummary } from './skills';
import type { AgentDocument, Locale } from './spec';

/** Options for formatting the temporal context block. */
export interface FormatTemporalOptions {
    /** Override current time for deterministic tests. Defaults to `new Date()`. */
    readonly now?: Date;
}

/** Options for assembling agent instructions. */
export interface BuildSystemInstructionsOptions {
    /** Whether to append temporal context. Defaults to `true`. */
    readonly temporal?: boolean;

    /** Override current time for deterministic tests or debugging. */
    readonly now?: Date;

    /** Discovered skills to inject into the Tier 1 XML catalog block. */
    readonly skills?: readonly SkillSummary[];

    /**
     * Trusted, structured runtime variables.
     * User-controlled free-form content should go into referenceContext.
     */
    readonly variables?: Readonly<Record<string, string>>;

    /**
     * Trusted, request-specific application instructions.
     * Don't use for retrieved documents or arbitrary user-provided content.
     */
    readonly additionalInstructions?: string | readonly string[];

    /**
     * Untrusted supplementary reference material.
     * Examples: retrieved documents, search results, external content.
     * Kept separate from instructions to preserve its trust boundary.
     */
    readonly referenceContext?: string | readonly string[];
}

/**
 * Result of assembling agent instructions.
 *
 * Sections are deliberately separated so provider adapters can decide
 * how to construct prompts and apply provider-specific caching.
 */
export interface BuiltInstructions {
    /**
     * Stable application instructions.
     * Suitable for the beginning of a cacheable prompt prefix.
     */
    readonly staticInstructions: string;

    /**
     * Request-specific application instructions.
     * Append after staticInstructions.
     */
    readonly dynamicInstructions: string;

    /**
     * Untrusted reference material.
     * Must be supplied separately from application instructions.
     */
    readonly referenceContext: readonly string[];
}

/**
 * Formats a temporal context block using the declared locale and time zone.
 *
 * The human-readable date follows the configured language.
 * The ISO date always uses YYYY-MM-DD.
 *
 * @param locale The locale containing the declared timeZone and language.
 * @param options Optional time override.
 * @returns Formatted Markdown temporal section.
 */
export function formatTemporalContext(locale: Locale, options: FormatTemporalOptions = {}): string {
    const now = options.now ?? new Date();

    const humanDate = new Intl.DateTimeFormat(locale.language, {
        timeZone: locale.timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(now);

    const isoParts = new Intl.DateTimeFormat('en', {
        timeZone: locale.timeZone,
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);

    const getPart = (type: 'year' | 'month' | 'day'): string => {
        const value = isoParts.find((part) => part.type === type)?.value;
        if (!value) {
            throw new Error(`Unable to format ISO date: missing ${type}`);
        }

        return value;
    };

    const isoDate = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

    return [
        '## Temporal context',
        `- Time zone: ${locale.timeZone}`,
        `- Current date: ${humanDate} (ISO: ${isoDate})`,
    ].join('\n');
}

/**
 * Normalizes a value to a single line for Markdown rendering.
 */
function toSingleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/**
 * Formats structured runtime variables as a Markdown section.
 */
function formatRuntimeVariables(variables: Readonly<Record<string, string>>): string {
    const entries = Object.entries(variables)
        .map(([key, value]) => [toSingleLine(key), toSingleLine(value)] as const)
        .filter(([key]) => key.length > 0)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `- ${key}: ${value}`);

    if (entries.length === 0) {
        return '';
    }

    return `## Runtime variables\n${entries.join('\n')}`;
}

/**
 * Normalizes optional content into non-empty, trimmed blocks.
 */
function normalizeBlocks(content: string | readonly string[] | undefined): string[] {
    if (content === undefined) {
        return [];
    }

    const blocks = typeof content === 'string' ? [content] : content;
    return blocks.map((block) => block.trim()).filter((block) => block.length > 0);
}

/**
 * Assembles provider-independent agent instructions.
 *
 * Section ordering:
 *
 * Static instructions:
 * 1. Agent document instructions.
 *
 * Dynamic instructions:
 * 1. Discovered skill catalog.
 * 2. Runtime variables.
 * 3. Temporal context.
 * 4. Additional application instructions.
 *
 * Reference context:
 * 1. Retrieved documents and other untrusted material.
 *
 * Static and dynamic instructions are returned separately to allow
 * provider adapters to apply caching strategies without modifying
 * the instruction-building logic.
 *
 * Reference material is never merged into application instructions.
 *
 * @param doc Agent document containing the manifest and instructions.
 * @param options Dynamic variables, skills, reference material, and temporal overrides.
 * @returns Separated instruction sections and reference material.
 */
export function buildSystemInstructions(
    doc: AgentDocument,
    options: BuildSystemInstructionsOptions = {},
): BuiltInstructions {
    const staticSections: string[] = [];
    const dynamicSections: string[] = [];

    // Stable application instructions
    const instructions = doc.instructions?.trim();
    if (instructions) {
        staticSections.push(instructions);
    }

    // Discovered skills
    if (options.skills?.length) {
        const catalog = formatSkillCatalog(options.skills).trim();
        if (catalog) {
            staticSections.push(catalog);
        }
    }

    // Structured runtime variables
    if (options.variables) {
        const variables = formatRuntimeVariables(options.variables);
        if (variables) {
            dynamicSections.push(variables);
        }
    }

    // Temporal context
    if (options.temporal !== false) {
        dynamicSections.push(
            formatTemporalContext(doc.manifest.spec.locale, {
                now: options.now,
            }),
        );
    }

    // Additional trusted application instructions
    dynamicSections.push(...normalizeBlocks(options.additionalInstructions));

    // Untrusted reference material
    const referenceContext = normalizeBlocks(options.referenceContext);

    return {
        staticInstructions: staticSections.join('\n\n'),
        dynamicInstructions: dynamicSections.join('\n\n'),
        referenceContext,
    };
}
