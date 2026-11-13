import { describe, expect, it, test } from 'bun:test';
import { executeHttpTool, type Tool } from '../../lib';

const baseTool: Tool = {
    name: 'test-tool',
    description: 'A tool for testing HTTP execution',
    inputSchema: { type: 'object' },
    execution: {
        type: 'http',
        method: 'GET',
        url: 'https://api.example.com/data',
    },
};

const textResponseMock = (async () =>
    new Response('OK - Request Received', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
    })) as unknown as typeof fetch;

const errorResponseMock = (async () =>
    new Response('Database deadlock error in clinic backend', { status: 500 })) as unknown as typeof fetch;

const getTool = (url: string): Tool => ({
    ...baseTool,
    execution: { type: 'http', method: 'GET', url },
});

describe('executeHttpTool - Security & SSRF Protection', () => {
    test.each(['file:///etc/passwd', 'ftp://ftp.example.com', 'gopher://evil.com', 'javascript:alert(1)'])(
        'rejects forbidden protocol %p',
        async (url) => {
            expect(executeHttpTool(getTool(url), { args: {} })).rejects.toThrow(/Protocol '.*' is forbidden/);
        },
    );

    test.each([
        'http://localhost:8080/admin',
        'http://127.0.0.1:3000/api',
        'http://0.0.0.0/status',
        'http://[::1]/debug',
    ])('blocks loopback address %p by default', async (url) => {
        expect(executeHttpTool(getTool(url), { args: {} })).rejects.toThrow(
            /Access to loopback address '.*' is blocked/,
        );
    });

    it('permits loopback address when allowLoopback: true', async () => {
        const result = await executeHttpTool(getTool('http://localhost:3000/test'), {
            args: {},
            fetch: textResponseMock,
            security: { allowLoopback: true },
        });

        expect(result).toBe('OK - Request Received');
    });

    test.each(['http://169.254.169.254/latest/meta-data', 'http://169.254.1.1/info'])(
        'strictly blocks cloud metadata address %p',
        async (url) => {
            expect(
                executeHttpTool(getTool(url), {
                    args: {},
                    security: { allowPrivateIps: true, allowLoopback: true },
                }),
            ).rejects.toThrow(/cloud metadata/);
        },
    );

    test.each(['http://10.0.0.1/admin', 'http://192.168.1.1/router', 'http://172.16.0.5/api'])(
        'blocks private subnet address %p by default',
        async (url) => {
            expect(executeHttpTool(getTool(url), { args: {} })).rejects.toThrow(
                /Access to private subnet IP '.*' is blocked/,
            );
        },
    );

    it('permits private subnet address when allowPrivateIps: true', async () => {
        const result = await executeHttpTool(getTool('http://10.0.0.1/api'), {
            args: {},
            fetch: textResponseMock,
            security: { allowPrivateIps: true },
        });

        expect(result).toBe('OK - Request Received');
    });

    it('enforces allowedHosts whitelist', async () => {
        expect(
            executeHttpTool(getTool('https://unauthorized.domain.com/data'), {
                args: {},
                security: { allowedHosts: ['api.clinic.com', 'trusted.org'] },
            }),
        ).rejects.toThrow(/is not in allowedHosts whitelist/);
    });
});

describe('executeHttpTool - Request Execution & Interpolation', () => {
    it('executes POST request with interpolated URL, headers, and body', async () => {
        let capturedUrl = '';
        let capturedHeaders: Headers | undefined;
        let capturedBody = '';

        const mockFetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            capturedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
            capturedHeaders = new Headers(init?.headers);
            capturedBody = typeof init?.body === 'string' ? init.body : '';

            return new Response(JSON.stringify({ success: true, slotId: 456 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as unknown as typeof fetch;

        const tool: Tool = {
            name: 'book-appointment',
            description: 'Books an appointment',
            inputSchema: { type: 'object' },
            execution: {
                type: 'http',
                method: 'POST',
                url: 'https://api.clinic.com/appointments?patient={{patientId}}',
                headers: {
                    Authorization: 'Bearer {{secret.API_KEY}}',
                    'Content-Type': 'application/json',
                },
                body: {
                    slot: '{{slotId}}',
                    confirmed: true,
                },
            },
        };

        const result = await executeHttpTool(tool, {
            args: { patientId: '102030', slotId: '456' },
            secrets: { API_KEY: 'secret-token-value' },
            fetch: mockFetch,
        });

        expect(capturedUrl).toBe('https://api.clinic.com/appointments?patient=102030');
        expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-token-value');
        expect(JSON.parse(capturedBody)).toEqual({ slot: '456', confirmed: true });
        expect(result).toEqual({ success: true, slotId: 456 });
    });

    it('returns plain text when response is not JSON', async () => {
        const result = await executeHttpTool(baseTool, {
            args: {},
            fetch: textResponseMock,
        });

        expect(result).toBe('OK - Request Received');
    });

    it('throws ParseError on non-2xx HTTP status codes with response snippet', async () => {
        expect(
            executeHttpTool(baseTool, {
                args: {},
                fetch: errorResponseMock,
            }),
        ).rejects.toThrow(/HTTP GET test-tool failed with status 500: Database deadlock error/);
    });

    it('throws ParseError when tool does not have execution block', async () => {
        const unexecutableTool: Tool = {
            name: 'noop-tool',
            description: 'A tool without execution metadata',
            inputSchema: { type: 'object' },
        };

        expect(executeHttpTool(unexecutableTool, { args: {} })).rejects.toThrow(
            /does not have an HTTP execution contract/,
        );
    });
});
