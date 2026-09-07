import type { CallToolResult } from '@modelcontextprotocol/client';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect, resultJson, resultText } from './harness.js';

/**
 * Whatever wg-easy sends, every read tool answers with a result the output
 * schema accepts, the two channels agree, and no runtime error names a
 * property of `null`.
 *
 * `SHAPE_RUNS=300` for a deep local pass; the CI count is small.
 */
const RUNS = { numRuns: Number(process.env.SHAPE_RUNS ?? 40) };

const ESC = String.fromCharCode(27);

/** A leaf that a backend could put in any field. */
const leaf = fc.oneof(
  fc.double(),
  fc.constant(null),
  fc.constant(-(2 ** 53)),
  fc.string({ maxLength: 20 }),
  fc.constant('x'.repeat(30_000)),
  fc.constant(`a${ESC}[0mb`),
  fc.constant('\ud800'),
  fc.boolean(),
  fc.constant({ toString: 'constructor' }),
  fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 })
);

const CLIENT_KEYS = [
  'id',
  'name',
  'enabled',
  'expiresAt',
  'ipv4Address',
  'allowedIps',
  'dns',
  'mtu',
  'transferRx',
  'latestHandshakeAt',
  'oneTimeLink',
  '__proto__',
  'truncated',
  'untrusted',
];

/** A client-shaped record with random leaves under the typed keys. */
const clientLike = fc.dictionary(fc.constantFrom(...CLIENT_KEYS), leaf, {
  maxKeys: 8,
});

/** The body of a JSON answer: a shaped envelope or anything at all. */
const body = fc.oneof(
  fc.jsonValue({ maxDepth: 3 }),
  clientLike,
  fc.array(fc.oneof(clientLike, leaf), { maxLength: 4 })
);

/** Serialised, with a `1e999` spliced in where a number sits. */
function serialise(value: unknown, sentinel: boolean): string {
  const text = JSON.stringify(value) ?? 'null';
  return sentinel
    ? text.replace(/(?<=[:[,])-?\d+(\.\d+)?(?=[,\]}])/, '1e999')
    : text;
}

const READ_TOOLS: [string, Record<string, unknown>][] = [
  ['list_clients', {}],
  ['get_client', { clientId: 1 }],
  ['get_server_info', {}],
  ['get_client_config', { clientId: 1 }],
  ['get_client_qrcode', { clientId: 1 }],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every read tool holds its output schema against any body', () => {
  it.each(READ_TOOLS)('%s', async (name, args) => {
    await fc.assert(
      fc.asyncProperty(body, fc.boolean(), async (value, sentinel) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              new Response(serialise(value, sentinel), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
          )
        );
        const client = await connect();
        const result = (await client.callTool({
          name,
          arguments: args,
        })) as CallToolResult;
        await client.close();

        const text = resultText(result);
        expect(text).not.toContain('Output validation error');
        expect(text).not.toContain('Cannot read properties');
        expect(text).not.toContain('is not a function');
        expect(text).not.toContain(ESC);
        if (result.isError !== true) {
          // Both channels, same value — `resultJson` asserts it.
          resultJson(result);
        }
      }),
      RUNS
    );
  });
});
