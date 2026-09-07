import type { CallToolResult } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import {
  confirmed,
  connect,
  jsonResponse,
  resultJson,
  resultText,
  stubFetch,
  textResponse,
} from './harness.js';

/**
 * The internal security review of 2026-09-07, as tests.
 *
 * Each block is one checklist item that the server had, with the input that
 * showed it. They assert on the request that went out, the result, or the
 * thrown error — never on "the guard was called".
 */

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);

describe('the boundary between wg-easy’s JSON and the output schema', () => {
  it('leaves out a typed field of the wrong type instead of failing the listing', async () => {
    // `id` as a string, `transferRx` as `1e999` (which `JSON.parse` reads as
    // `Infinity`) and a numeric `name`. Each used to answer the *whole* list
    // with `Output validation error`, cause unnamed.
    stubFetch(
      () =>
        new Response(
          '[{"id":"5","name":7,"transferRx":1e999,"enabled":"yes","extra":{"x":1}},' +
            '{"id":2,"name":"phone","transferRx":-0}]',
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const client = await connect();

    const result = (await client.callTool({
      name: 'list_clients',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const payload = resultJson(result) as {
      count: number;
      clients: Record<string, unknown>[];
    };
    expect(payload.count).toBe(2);
    expect(payload.clients[0]).toEqual({ extra: { x: 1 } });
    // `-0` serialises as `0`; the two channels must agree.
    expect(Object.is(payload.clients[1]?.transferRx, 0)).toBe(true);
  });

  it('counts entries of the list that are not client records', async () => {
    stubFetch(() => jsonResponse([{ id: 1, name: 'a' }, 'junk', null, 42]));
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'list_clients',
        arguments: {},
      })) as CallToolResult
    ) as { count: number; skipped?: number; clients: unknown[] };

    expect(payload.count).toBe(1);
    expect(payload.skipped).toBe(3);
  });

  it('answers a non-array client list as an empty one', async () => {
    stubFetch(() => jsonResponse({ oops: true }));
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'list_clients',
        arguments: {},
      })) as CallToolResult
    ) as { count: number; clients: unknown[] };

    expect(payload.count).toBe(0);
    expect(payload.clients).toEqual([]);
  });

  it('survives a null body where a client was expected, before the dialog', async () => {
    // `clientName` used to read `.name` off whatever came back; `null`
    // threw "Cannot read properties of null" out of the tool.
    const calls = stubFetch(() => jsonResponse(null));
    const client = await connect();

    const result = (await client.callTool({
      name: 'delete_client',
      arguments: { clientId: 3 },
    })) as CallToolResult;

    expect(resultText(result)).not.toContain('Cannot read properties');
    expect(resultText(result)).toContain('#3');
    // Only the lookup went out; nothing was deleted.
    expect(calls.every((call) => call.init?.method !== 'DELETE')).toBe(true);
  });

  it('merges an update over a body that is not an object', async () => {
    const calls = stubFetch((url, init) =>
      init?.method === 'POST'
        ? jsonResponse({ id: 3, name: 'x' })
        : textResponse('nope')
    );
    const client = await connect();

    const result = await confirmed(client, 'update_client', {
      clientId: 3,
      name: 'x',
    });

    expect(result.isError).toBeUndefined();
    const post = calls.find((call) => call.init?.method === 'POST');
    const body = JSON.parse(String(post?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body.name).toBe('x');
    expect(body.mtu).toBeNull();
  });

  it('reports a section of get_server_info that is not an object', async () => {
    stubFetch((url) =>
      url.endsWith('/api/information')
        ? textResponse('<maintenance/>')
        : url.endsWith('/api/admin/general')
          ? jsonResponse([1, 2])
          : jsonResponse({ ok: true })
    );
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_server_info',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const data = resultJson(result) as Record<string, { error?: string }>;
    expect(data.information?.error).toContain('a string');
    expect(data.general?.error).toContain('an array');
    expect(data.interface).toEqual({ ok: true });
  });

  it('reads the one-time link back with its types', async () => {
    stubFetch((url, init) =>
      init?.method === 'POST'
        ? jsonResponse({ ok: true })
        : jsonResponse([
            { id: 4, oneTimeLink: { oneTimeLink: 12345, expiresAt: 99 } },
          ])
    );
    const client = await connect();

    const result = await confirmed(client, 'generate_one_time_link', {
      clientId: 4,
    });

    expect(result.isError).toBeUndefined();
    const payload = resultJson(result) as { created: true; warning?: string };
    expect(payload.created).toBe(true);
    expect(payload.warning).toContain('was not in the client list');
  });
});

describe('the metrics password', () => {
  it('is redacted under its compound key', async () => {
    // `GET /api/admin/general` carries the argon2 hash of the metrics token
    // as `metricsPassword`. The exact-match list said `password`, so the hash
    // reached the model through a tool whose description promises that
    // passwords are redacted.
    stubFetch((url) =>
      url.endsWith('/api/admin/general')
        ? jsonResponse({
            sessionTimeout: 3600,
            metricsPrometheus: true,
            metricsPassword: '$argon2id$v=19$m=65536,t=3,p=4$HASH',
          })
        : jsonResponse({ publicKey: 'pk', privateKey: 'sk' })
    );
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_server_info',
      arguments: {},
    })) as CallToolResult;

    const text = resultText(result);
    expect(text).not.toContain('argon2');
    expect(text).not.toContain('HASH');
    expect(text).toContain('"metricsPassword": "[redacted]"');
    expect(text).toContain('"publicKey": "pk"');
    expect(text).toContain('"sessionTimeout": 3600');
  });
});

describe('the clientId ceiling', () => {
  it.each([
    '9'.repeat(400),
    '9007199254740993',
    '1'.repeat(17),
    '0'.repeat(16),
  ])('refuses %s rather than reinterpreting it', async (value) => {
    // Four hundred nines became `Infinity` and went out as
    // `GET /api/client/Infinity`; seventeen digits became a *different*
    // number on the way to the path.
    const calls = stubFetch(() => jsonResponse({ id: 1 }));
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_client',
      arguments: { clientId: value },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('still takes fifteen digits', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 1 }));
    const client = await connect();
    await client.callTool({
      name: 'get_client',
      arguments: { clientId: '123456789012345' },
    });
    expect(calls[0]?.url).toBe(
      'http://wg.test:51821/api/client/123456789012345'
    );
  });
});

describe('caller input has a length', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['list_clients', { filter: 'x'.repeat(201) }],
    ['create_client', { name: 'x'.repeat(201) }],
    ['create_client', { name: 'x', expiresAt: 'x'.repeat(65) }],
    ['update_client', { clientId: 1, name: 'x'.repeat(201) }],
    ['update_client', { clientId: 1, ipv4Address: 'x'.repeat(65) }],
    ['update_client', { clientId: 1, dns: Array(65).fill('1.1.1.1') }],
    ['update_client', { clientId: 1, allowedIps: ['x'.repeat(65)] }],
    ['update_client', { clientId: 1, mtu: 9001 }],
    ['update_client', { clientId: 1, mtu: 1279 }],
    ['update_client', { clientId: 1, persistentKeepalive: 65536 }],
  ];

  it.each(cases)('%s refuses %j past the ceiling', async (name, args) => {
    const calls = stubFetch(() => jsonResponse({ id: 1 }));
    const client = await connect({}, 'accept');

    const result = (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('accepts the ceiling itself', async () => {
    const calls = stubFetch(() => jsonResponse([]));
    const client = await connect();
    await client.callTool({
      name: 'list_clients',
      arguments: { filter: 'x'.repeat(200) },
    });
    expect(calls).toHaveLength(1);
  });
});

describe('what the instance wrote, on its way to the model', () => {
  it('strips control characters from record fields, keys included', async () => {
    stubFetch(() =>
      jsonResponse([
        {
          id: 1,
          name: `lap${ESC}[31mtop`,
          dns: [`1.1.1.1${NUL}`],
          [`ke${ESC}y`]: 'v\tv\nw',
        },
      ])
    );
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'list_clients',
        arguments: {},
      })) as CallToolResult
    ) as { clients: Record<string, unknown>[] };

    expect(payload.clients[0]).toEqual({
      id: 1,
      name: 'lap[31mtop',
      dns: ['1.1.1.1'],
      key: 'v\tv\nw',
    });
  });

  it('keeps the configuration file byte for byte and says so', async () => {
    // A `.conf` has to round-trip; a control character in it is kept and
    // named rather than removed in silence.
    const conf = `[Interface]\nPrivateKey = abc${ESC}\n`;
    stubFetch(() => textResponse(conf));
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'get_client_config',
        arguments: { clientId: 1 },
      })) as CallToolResult
    ) as { configuration: string; warning?: string };

    expect(payload.configuration).toBe(conf);
    expect(payload.warning).toContain('control characters');
  });

  it('carries no warning when the file is clean', async () => {
    stubFetch(() => textResponse('[Interface]\nPrivateKey = abc\n'));
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'get_client_qrcode',
        arguments: { clientId: 1 },
      })) as CallToolResult
    ) as { svg: string; warning?: string };

    expect(payload.warning).toBeUndefined();
  });

  it('does not answer "[object Object]" when the file endpoint answers JSON', async () => {
    stubFetch(() => jsonResponse({ message: 'not found' }));
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_client_config',
      arguments: { clientId: 1 },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('an object');
    expect(resultText(result)).not.toContain('[object Object]');
  });

  it('labels and cleans an error body, and cuts it at 200 characters', async () => {
    stubFetch(() => textResponse(`${ESC}[2Jbad ${'x'.repeat(500)}`, 400));
    const client = await connect();

    const result = (await client.callTool({
      name: 'list_clients',
      arguments: {},
    })) as CallToolResult;

    const text = resultText(result);
    expect(text).toContain('(untrusted text from the instance): [2Jbad');
    expect(text).not.toContain(ESC);
    expect(text).toContain('… (truncated)');
    expect(text.length).toBeLessThan(500);
  });

  it('keeps the truncation note when the record carries a field of that name', async () => {
    stubFetch(() =>
      jsonResponse({ id: 1, name: 'x'.repeat(100_000), truncated: 'lie' })
    );
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'get_client',
        arguments: { clientId: 1 },
      })) as CallToolResult
    ) as { truncated?: { fields?: Record<string, unknown> } };

    expect(payload.truncated?.fields?.name).toBeDefined();
  });

  it('drops a __proto__ key in both channels, without hanging', async () => {
    // The schema validator on the far side drops the key from
    // `structuredContent`; the text block used to keep it, so the two
    // channels disagreed. And `container['__proto__'] = shortened` in the
    // budget would have set a prototype instead of shortening anything.
    stubFetch(
      () =>
        new Response(`{"id":1,"__proto__":"${'x'.repeat(100_000)}"}`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_client',
      arguments: { clientId: 1 },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const payload = resultJson(result) as Record<string, unknown>;
    expect(payload).toEqual({ untrusted: true, source: 'wg-easy', id: 1 });
    expect(resultText(result)).not.toContain('__proto__');
  });

  it('writes a non-finite number as JSON does, in both channels', async () => {
    stubFetch(
      () =>
        new Response('{"id":1,"custom":1e999,"other":-0}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'get_client',
        arguments: { clientId: 1 },
      })) as CallToolResult
    ) as Record<string, unknown>;

    expect(payload.custom).toBeNull();
    expect(Object.is(payload.other, 0)).toBe(true);
  });

  it('shortens a long string that sits inside an array', async () => {
    // The budget's other slot kind. A DNS list of one enormous entry has no
    // long string under a *key* anywhere — the value hangs off an index — and
    // the answer is unshortenable if the walk does not look there.
    stubFetch(() => jsonResponse({ id: 1, dns: ['x'.repeat(100_000)] }));
    const client = await connect();

    const payload = resultJson(
      (await client.callTool({
        name: 'get_client',
        arguments: { clientId: 1 },
      })) as CallToolResult
    ) as { truncated?: { fields: Record<string, unknown> } };

    expect(payload.truncated?.fields['dns[0]']).toBeDefined();
  });

  it('says "(none)" when an update carries no field to change', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 3, name: 'x' }));
    const client = await connect({}, 'accept');

    const result = (await client.callTool({
      name: 'update_client',
      arguments: { clientId: 3 },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    expect(client.prompts.join('\n')).toContain('(none)');
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(true);
  });

  it('shortens an oversized QR code rather than answering out of schema', async () => {
    // The docblock's own example — a 70 kB SVG — used to leave as a result
    // with a `truncated` field the closed schema of get_client_qrcode did
    // not declare: a ProtocolError for any client that had listed the tools.
    stubFetch(() => textResponse(`<svg>${'x'.repeat(70_000)}</svg>`));
    const client = await connect();

    const result = (await client.callTool({
      name: 'get_client_qrcode',
      arguments: { clientId: 1 },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const payload = resultJson(result) as {
      svg: string;
      truncated?: { fields: Record<string, unknown> };
    };
    expect(payload.truncated?.fields.svg).toBeDefined();
  });
});
