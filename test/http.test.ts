import { describe, expect, test } from 'vitest';
import { HttpError, ParseError } from '../lib/errors.ts';
import { executeHttp } from '../lib/http.ts';
import type { HttpExecution } from '../lib/schema.ts';

const stubFetch = (fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch => fn;

const okFetch = stubFetch(async () => new Response('ok', { status: 200 }));

const exec = (url: string, overrides: Partial<HttpExecution> = {}): HttpExecution => ({
    type: 'http',
    method: 'GET',
    url,
    ...overrides,
});

describe('executeHttp - SSRF protection', () => {
    test.each(['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)'])(
        'blocks forbidden protocol %p',
        async (url) => {
            await expect(executeHttp(exec(url), 't', {})).rejects.toThrow(/Protocol '.*' is forbidden/);
        },
    );

    test.each([
        'http://localhost:8080/admin',
        'http://localhost./admin',
        'http://sub.localhost/admin',
        'http://127.0.0.1:3000',
        'http://0.0.0.0',
        'http://[::1]',
        'http://[::ffff:127.0.0.1]',
    ])('blocks loopback address %p by default', async (url) => {
        await expect(executeHttp(exec(url), 't', {})).rejects.toThrow(/loopback/);
    });

    test.each([
        'http://10.0.0.1',
        'http://172.16.0.5',
        'http://192.168.1.1',
        'http://[fc00::1]',
        'http://[::ffff:10.0.0.1]',
    ])('blocks private address %p by default', async (url) => {
        await expect(executeHttp(exec(url), 't', {})).rejects.toThrow(/private subnet/);
    });

    test.each(['http://169.254.169.254/latest/meta-data', 'http://[fe80::1]/', 'http://100.64.0.1/'])(
        'strictly blocks metadata / reserved IP %p',
        async (url) => {
            await expect(
                executeHttp(exec(url), 't', {}, { security: { allowLoopback: true, allowPrivateIps: true } }),
            ).rejects.toThrow(ParseError);
        },
    );

    test('permits loopback, private IPs, and domains like 10.example.com when configured', async () => {
        expect(
            await executeHttp(
                exec('http://localhost:3000'),
                't',
                {},
                { fetch: okFetch, security: { allowLoopback: true } },
            ),
        ).toBe('ok');
        expect(
            await executeHttp(
                exec('http://10.0.0.1'),
                't',
                {},
                { fetch: okFetch, security: { allowPrivateIps: true } },
            ),
        ).toBe('ok');
        expect(await executeHttp(exec('https://10.example.com/api'), 't', {}, { fetch: okFetch })).toBe('ok');
    });

    test('enforces allowedHosts and treats empty [] as deny-all', async () => {
        await expect(
            executeHttp(exec('https://evil.com'), 't', {}, { security: { allowedHosts: ['api.example.com'] } }),
        ).rejects.toThrow(/allowedHosts/);

        await expect(
            executeHttp(exec('https://api.example.com'), 't', {}, { security: { allowedHosts: [] } }),
        ).rejects.toThrow(/allowedHosts/);
    });
});

describe('executeHttp - requests and errors', () => {
    test('interpolates URL, headers, and JSON body and parses +json responses', async () => {
        let capturedInit: RequestInit | undefined;
        let capturedUrl = '';

        const mock = stubFetch(async (url, init) => {
            capturedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
            capturedInit = init;
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
            });
        });

        const result = await executeHttp(
            exec('https://api.example.com/items?q={{q}}', {
                method: 'POST',
                headers: { Authorization: 'Bearer {{secret.KEY}}' },
                body: { id: '{{id}}', active: true },
            }),
            'book',
            { q: 'a b', id: 7 },
            { secrets: { KEY: 'sec' }, fetch: mock },
        );

        expect(capturedUrl).toBe('https://api.example.com/items?q=a%20b');
        expect(capturedInit?.redirect).toBe('error');
        expect(new Headers(capturedInit?.headers).get('Authorization')).toBe('Bearer sec');
        expect(capturedInit?.body).toBe(JSON.stringify({ id: '7', active: true }));
        expect(result).toEqual({ ok: true });
    });

    test('returns empty string on 204 / empty body', async () => {
        const empty = stubFetch(async () => new Response(null, { status: 204 }));
        expect(
            await executeHttp(exec('https://api.example.com/item', { method: 'DELETE' }), 'del', {}, { fetch: empty }),
        ).toBe('');
    });

    test('throws HttpError on non-2xx status, invalid JSON, timeout, and redirect errors', async () => {
        const fail500 = stubFetch(async () => new Response('db down', { status: 500 }));
        await expect(executeHttp(exec('https://api.example.com'), 't', {}, { fetch: fail500 })).rejects.toMatchObject({
            name: 'HttpError',
            status: 500,
        });

        const badJson = stubFetch(
            async () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
        await expect(executeHttp(exec('https://api.example.com'), 't', {}, { fetch: badJson })).rejects.toBeInstanceOf(
            HttpError,
        );

        const timeout = stubFetch(async () => {
            throw new DOMException('aborted', 'TimeoutError');
        });
        await expect(
            executeHttp(exec('https://api.example.com', { timeoutMs: 10 }), 't', {}, { fetch: timeout }),
        ).rejects.toMatchObject({
            name: 'HttpError',
            status: 504,
        });

        const netErr = stubFetch(async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(executeHttp(exec('https://api.example.com'), 't', {}, { fetch: netErr })).rejects.toMatchObject({
            name: 'HttpError',
            status: 502,
        });
    });
});
