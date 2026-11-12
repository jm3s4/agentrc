import ipaddr from 'ipaddr.js';
import { ParseError } from '../errors';
import type { HttpExecution, Tool } from '../spec';
import { resolveTemplate, resolveTemplateRecord, type TemplateContext } from './template';

/** Security policy for HTTP tool execution to prevent SSRF attacks. */
export interface HttpSecurityOptions {
    /** Allow loopback addresses (localhost, 127.0.0.0/8, ::1, 0.0.0.0, ::). Default: false. */
    readonly allowLoopback?: boolean;
    /** Allow private subnets (RFC 1918 and IPv6 ULA fc00::/7). Default: false. */
    readonly allowPrivateIps?: boolean;
    /**
     * Optional allowlist of allowed hostnames.
     * If set, only these hosts are allowed (an empty array blocks all hosts).
     */
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
    /** Custom fetch implementation (for proxies, DNS pinning, or custom agents). */
    readonly fetch?: typeof fetch;
    /** Optional cancellation signal. */
    readonly signal?: AbortSignal;
}

type ResolveContext = Omit<TemplateContext, 'encodeUrl'>;

/** Strips IPv6 brackets, trailing dots, and IPv4-mapped IPv6 wrappers for comparisons. */
function normalizeHost(hostname: string): string {
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return bare.toLowerCase().replace(/\.+$/, '');
}

/**
 * Validates that a resolved tool URL is safe to dispatch from this process.
 *
 * @remarks
 * Tool URLs live in YAML artifacts and can be steered by template arguments.
 * An attacker who controls a URL can otherwise reach internal services.
 * Rejects any target that is not a public unicast address.
 *
 * Blocked ranges:
 *
 * - loopback (`127.0.0.0/8`, `::1`): admin panels, Docker socket proxies.
 * - unspecified (`0.0.0.0`, `::`): aliases loopback at the socket layer.
 * - private (`10/8`, `172.16/12`, `192.168/16`): VPCs, pod and service CIDRs.
 * - uniqueLocal (`fc00::/7`): IPv6 RFC 1918.
 * - linkLocal (`169.254/16`, `fe80::/10`): cloud metadata endpoints.
 * - carrierGradeNat (`100.64/10`): Alibaba metadata, Tailscale MagicDNS.
 * - multicast (`224/4`, `ff00::/8`, `255.255.255.255`).
 * - reserved (`192.0.2/24`, `198.18/15`, `240/4`, 6to4, Teredo, NAT64).
 *
 * Anything classified as unicast is allowed, subject to `allowedHosts`.
 *
 * `allowLoopback` and `allowPrivateIps` relax loopback, unspecified, private,
 * and uniqueLocal. `allowedHosts` is checked before IP classification; an
 * empty array blocks every host, `undefined` disables the allowlist.
 * linkLocal, carrierGradeNat, and reserved are never overridable.
 *
 * The hostname is validated literally, before DNS. Rebinding and wildcard
 * DNS are stopped only at connect time; pass a DNS-pinning `fetch` or use an
 * egress proxy. Numeric host forms such as `2130706433` are caught only
 * because WHATWG URL parsers normalize them to dotted IPv4.
 *
 * @param urlString Fully interpolated URL, after template resolution.
 * @param security Optional allowlist and range overrides.
 * @returns The parsed URL, ready for dispatch.
 * @throws {@link ParseError} if the URL is invalid, the protocol is not
 *   `http` or `https`, the host is not in `allowedHosts`, or the target falls
 *   into a blocked range.
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
    if (range === 'unicast') {
        return parsed;
    }

    if (range === 'loopback' || range === 'unspecified') {
        if (!security.allowLoopback) {
            throw new ParseError(`Security violation: Access to loopback address '${host}' is blocked`);
        }
        return parsed;
    }

    if (range === 'private' || range === 'uniqueLocal') {
        if (!security.allowPrivateIps) {
            throw new ParseError(`Security violation: Access to private subnet IP '${host}' is blocked`);
        }
        return parsed;
    }

    if (range === 'linkLocal') {
        throw new ParseError('Security violation: Access to cloud metadata / link-local IP is strictly blocked');
    }

    throw new ParseError(`Security violation: Access to reserved IP '${host}' (${range}) is blocked`);
}

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

function resolveBody(body: HttpExecution['body'], context: ResolveContext): string | undefined {
    if (!body) {
        return undefined;
    }

    if (typeof body === 'string') {
        return resolveTemplate(body, context);
    }

    return JSON.stringify(resolveValue(body, context));
}

/**
 * Executes a declarative HTTP tool contract directly on the consumer application.
 *
 * @param tool The Tool definition containing an HTTP execution block.
 * @param options Tool arguments, secrets, and security configuration.
 * @returns Parsed JSON or text response from the endpoint.
 * @throws {ParseError} If tool execution metadata is missing, templates cannot be resolved, URL fails SSRF checks, or the HTTP request fails.
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
        const resolvedHeaders = resolveTemplateRecord(exec.headers, { args, secrets });
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

    let response: Response;
    try {
        response = await customFetch(targetUrl, {
            method: exec.method,
            headers,
            body: resolvedBody,
            redirect: 'error',
            signal: combinedSignal,
        });
    } catch (error) {
        if (combinedSignal?.aborted) {
            throw error;
        }
        throw new ParseError(`HTTP ${exec.method} ${tool.name} request failed`, error);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ParseError(
            `HTTP ${exec.method} ${tool.name} failed with status ${response.status}: ${errorText.slice(0, 300)}`,
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
        throw new ParseError(`HTTP ${exec.method} ${tool.name} returned invalid JSON`, error);
    }
}
