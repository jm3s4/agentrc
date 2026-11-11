import { ParseError } from '../errors';
import type { HttpExecution, Tool } from '../spec';
import { resolveTemplate, resolveTemplateRecord } from './template';

/** Security policy for HTTP tool execution to prevent SSRF attacks. */
export interface HttpSecurityOptions {
    /** Allow loopback addresses (localhost, 127.0.0.1, ::1). Default: false. */
    readonly allowLoopback?: boolean;
    /** Allow private RFC 1918 subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Default: false. */
    readonly allowPrivateIps?: boolean;
    /** Optional whitelist of permitted hostnames. If set, only these hosts are allowed. */
    readonly allowedHosts?: readonly string[];
}

/** Options to execute the HTTP tool. */
export interface ExecuteHttpToolOptions {
    /** Tool arguments passed by the model. */
    readonly args: Readonly<Record<string, unknown>>;
    /** Secret mapping for resolving `{{secret.NAME}}` templates. */
    readonly secrets?: Readonly<Record<string, string>>;
    /** SSRF and network security configuration. */
    readonly security?: HttpSecurityOptions;
    /** Custom fetch implementation (for proxies, custom agents). */
    readonly fetch?: typeof fetch;
    /** Optional cancellation signal. */
    readonly signal?: AbortSignal;
}

/** Strips IPv6 brackets in `.hostname` ('[::1]') for comparisons. */
function normalizeHost(hostname: string): string {
    const lower = hostname.toLowerCase();
    return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
}

/** Validates that a target URL is safe from SSRF, metadata access, and protocol smuggling. */
function assertSafeUrl(urlString: string, security: HttpSecurityOptions = {}): URL {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new ParseError(`Invalid URL format: ${urlString}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ParseError(`Security violation: Protocol '${parsed.protocol}' is forbidden (http/https only)`);
    }

    const host = normalizeHost(parsed.hostname);
    if (security.allowedHosts && security.allowedHosts.length > 0) {
        const allowed = security.allowedHosts.map(normalizeHost);
        if (!allowed.includes(host)) {
            throw new ParseError(`Security violation: Host '${host}' is not in allowedHosts whitelist`);
        }
    }

    const isLoopback = host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.');
    if (isLoopback && !security.allowLoopback) {
        throw new ParseError(`Security violation: Access to loopback address '${host}' is blocked`);
    }

    if (host === '169.254.169.254' || host.startsWith('169.254.')) {
        throw new ParseError('Security violation: Access to cloud metadata IP (169.254.x.x) is strictly blocked');
    }

    const isPrivate =
        host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
    if (isPrivate && !security.allowPrivateIps) {
        throw new ParseError(`Security violation: Access to private subnet IP '${host}' is blocked`);
    }

    return parsed;
}

function resolveValue(
    value: unknown,
    context: {
        args: Readonly<Record<string, unknown>>;
        secrets?: Readonly<Record<string, string>>;
    },
): unknown {
    if (typeof value === 'string') {
        return resolveTemplate(value, { ...context, encodeUrl: false });
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

function resolveBody(
    body: HttpExecution['body'],
    context: {
        args: Readonly<Record<string, unknown>>;
        secrets?: Readonly<Record<string, string>>;
    },
): string | undefined {
    if (!body) {
        return undefined;
    }

    if (typeof body === 'string') {
        return resolveTemplate(body, { ...context, encodeUrl: false });
    }

    return JSON.stringify(resolveValue(body, context));
}

/**
 * Executes a declarative HTTP tool contract directly on the consumer application.
 *
 * @param tool The Tool definition containing an HTTP execution block.
 * @param options Tool arguments, secrets, and security configuration.
 * @returns Parsed JSON or text response from the endpoint.
 * @throws {ParseError} If tool execution metadata is missing, templates cannot be resolved, or URL fails SSRF checks.
 */
export async function executeHttpTool(tool: Tool, options: ExecuteHttpToolOptions): Promise<unknown> {
    const exec = tool.execution;
    if (!exec || exec.type !== 'http') {
        throw new ParseError(`Tool '${tool.name}' does not have an HTTP execution contract`);
    }

    const { args, secrets = {}, security, fetch: customFetch = globalThis.fetch, signal } = options;

    const resolvedUrlString = resolveTemplate(exec.url, { args, secrets, encodeUrl: true });
    const targetUrl = assertSafeUrl(resolvedUrlString, security);

    const headers = new Headers();
    if (exec.headers) {
        const resolvedHeaders = resolveTemplateRecord(exec.headers, { args, secrets, encodeUrl: false });
        for (const [key, value] of Object.entries(resolvedHeaders)) {
            headers.set(key, value);
        }
    }

    const resolvedBody = resolveBody(exec.body, { args, secrets });

    const signals: AbortSignal[] = [];
    if (signal) {
        signals.push(signal);
    }
    if (exec.timeoutMs) {
        signals.push(AbortSignal.timeout(exec.timeoutMs));
    }
    const combinedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    const response = await customFetch(targetUrl, {
        method: exec.method,
        headers,
        body: resolvedBody,
        signal: combinedSignal,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ParseError(
            `HTTP ${exec.method} ${tool.name} failed with status ${response.status}: ${errorText.slice(0, 300)}`,
        );
    }

    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : response.text();
}
