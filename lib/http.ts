import ipaddr from 'ipaddr.js';
import { HttpError, ParseError } from './errors.ts';
import type { HttpExecution } from './schema.ts';
import { resolveTemplate, resolveTemplateRecord, type TemplateContext } from './template.ts';

/** SSRF guardrails applied before dispatching an HTTP tool request. */
export interface HttpSecurityOptions {
    /** Allow loopback targets (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`, `::`). Default: `false`. */
    readonly allowLoopback?: boolean;
    /** Allow private subnets (RFC 1918 and IPv6 ULA `fc00::/7`). Default: `false`. */
    readonly allowPrivateIps?: boolean;
    /** Explicit hostname allowlist. An empty array denies all hosts; `undefined` disables the allowlist. */
    readonly allowedHosts?: readonly string[];
}

/** Request-scoped dependencies and policy overrides for `executeHttp`. */
export interface HttpDispatchOptions {
    readonly secrets?: Readonly<Record<string, string>>;
    readonly security?: HttpSecurityOptions;
    readonly fetch?: typeof fetch;
    readonly signal?: AbortSignal;
}

/** Template context for value resolution, which never URL-encodes substituted strings. */
type ResolveContext = Omit<TemplateContext, 'encodeUrl'>;

/** Strips IPv6 brackets, lowercases, and drops trailing dots so hostnames compare consistently. */
function normalizeHost(hostname: string): string {
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return bare.toLowerCase().replace(/\.+$/, '');
}

/**
 * Validates the literal URL host against protocol, allowlist, and non-public IP ranges.
 * Defending against DNS rebinding requires a DNS-pinning `fetch` or egress proxy.
 */
function assertSafeUrl(urlString: string, security: HttpSecurityOptions = {}): URL {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new ParseError('Invalid URL format');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ParseError(`Security violation: Protocol '${parsed.protocol}' is forbidden (http/https only)`);
    }

    const host = normalizeHost(parsed.hostname);
    if (security.allowedHosts !== undefined) {
        const allowed = security.allowedHosts.map(normalizeHost);
        if (!allowed.includes(host)) {
            throw new ParseError(`Security violation: Host '${host}' is not in allowedHosts whitelist`);
        }
    }

    if (host === 'localhost' || host.endsWith('.localhost')) {
        if (!security.allowLoopback) {
            throw new ParseError(`Security violation: Access to loopback address '${host}' is blocked`);
        }
        return parsed;
    }

    if (!ipaddr.isValid(host)) {
        return parsed;
    }

    const range = ipaddr.process(host).range();
    switch (range) {
        case 'unicast':
            return parsed;
        case 'loopback':
        case 'unspecified':
            if (!security.allowLoopback) {
                throw new ParseError(`Security violation: Access to loopback address '${host}' is blocked`);
            }
            return parsed;
        case 'private':
        case 'uniqueLocal':
            if (!security.allowPrivateIps) {
                throw new ParseError(`Security violation: Access to private subnet IP '${host}' is blocked`);
            }
            return parsed;
        case 'linkLocal':
            throw new ParseError('Security violation: Access to cloud metadata / link-local IP is strictly blocked');
        default:
            throw new ParseError(`Security violation: Access to reserved IP '${host}' (${range}) is blocked`);
    }
}

/** Recursively interpolates template strings in objects and arrays, leaving other values untouched. */
function resolveValue(value: unknown, context: ResolveContext): unknown {
    if (typeof value === 'string') {
        return resolveTemplate(value, context);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveValue(item, context));
    }
    if (typeof value === 'object' && value !== null) {
        const resolved: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            resolved[k] = resolveValue(v, context);
        }
        return resolved;
    }
    return value;
}

/** Resolves the request body, serializing non-string bodies to JSON after interpolation. */
function resolveBody(body: HttpExecution['body'], context: ResolveContext): string | undefined {
    if (!body) {
        return undefined;
    }
    if (typeof body === 'string') {
        return resolveTemplate(body, context);
    }
    return JSON.stringify(resolveValue(body, context));
}

/** Dispatches a declarative HTTP execution block after template resolution and SSRF checks. */
export async function executeHttp(
    exec: HttpExecution,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    options: HttpDispatchOptions = {},
): Promise<unknown> {
    const { secrets = {}, security, fetch: customFetch = globalThis.fetch, signal } = options;

    const resolvedUrl = resolveTemplate(exec.url, { args, secrets, encodeUrl: true });
    const targetUrl = assertSafeUrl(resolvedUrl, security);

    const headers = new Headers();
    if (exec.headers) {
        for (const [key, value] of Object.entries(resolveTemplateRecord(exec.headers, { args, secrets }))) {
            headers.set(key, value);
        }
    }

    const body = resolveBody(exec.body, { args, secrets });

    const signals = [signal, exec.timeoutMs ? AbortSignal.timeout(exec.timeoutMs) : undefined].filter(
        (s) => s !== undefined,
    );
    const combinedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    let response: Response;
    try {
        response = await customFetch(targetUrl, {
            method: exec.method,
            headers,
            body,
            redirect: 'error',
            signal: combinedSignal,
        });
    } catch (error) {
        if (signal?.aborted) {
            throw error;
        }
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new HttpError(`HTTP ${exec.method} ${toolName} timed out after ${exec.timeoutMs}ms`, 504, error);
        }
        throw new HttpError(`HTTP ${exec.method} ${toolName} request failed`, 502, error);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new HttpError(
            `HTTP ${exec.method} ${toolName} failed with status ${response.status}: ${errorText.slice(0, 300)}`,
            response.status,
        );
    }

    const text = await response.text();
    if (!text) {
        return '';
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/application\/([a-z0-9.+-]+\+)?json/i.test(contentType)) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new HttpError(`HTTP ${exec.method} ${toolName} returned invalid JSON`, response.status, error);
    }
}
