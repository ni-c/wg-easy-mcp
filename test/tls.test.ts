import { afterEach, describe, expect, it, vi } from 'vitest';

import { WgEasyApi } from '../src/api.js';
import { stubFetch, testConfig } from './harness.js';

/**
 * The one code path that weakens TLS, in its own file because `vi.mock` is
 * hoisted above every import of the module under test.
 */
const undiciFetch = vi.hoisted(() =>
  vi.fn(
    async (_url: unknown, _init?: unknown) =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )
);

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: undiciFetch };
});

afterEach(() => {
  vi.unstubAllGlobals();
  undiciFetch.mockClear();
});

describe('WG_EASY_INSECURE_TLS', () => {
  it('routes requests through a dispatcher that skips verification, and only then', async () => {
    const globalCalls = stubFetch(() => new Response('[]'));
    const api = new WgEasyApi(testConfig({ insecureTls: true }));

    await api.get('/api/client');

    expect(globalCalls).toHaveLength(0);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    const init = undiciFetch.mock.calls[0]?.[1] as
      { dispatcher?: { [key: symbol]: unknown } } | undefined;
    expect(init?.dispatcher).toBeDefined();
    // The relaxation is scoped to the dispatcher, not to the process.
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('uses the global fetch, with no dispatcher, when the switch is off', async () => {
    const globalCalls = stubFetch(
      () =>
        new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const api = new WgEasyApi(testConfig());

    await api.get('/api/client');

    expect(globalCalls).toHaveLength(1);
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(
      (globalCalls[0]?.init as { dispatcher?: unknown } | undefined)?.dispatcher
    ).toBeUndefined();
  });
});
