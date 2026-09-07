import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_BODY_BYTES,
  ResponseTooLargeError,
  WgEasyApi,
  WgEasyApiError,
} from '../src/api.js';
import { stubFetch, testConfig } from './harness.js';

/**
 * A body that keeps sending. `pulls` counts how often it was asked for the
 * next chunk, which is how the test knows the reader stopped.
 */
function endlessResponse(
  status = 200,
  chunk = 64 * 1024
): {
  response: Response;
  pulls: () => number;
  cancelled: () => boolean;
} {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(chunk).fill(120));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, {
      status,
      headers: { 'content-type': 'application/json' },
    }),
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a body that never ends', () => {
  it('is cancelled at the ceiling and refused', async () => {
    const endless = endlessResponse();
    stubFetch(() => endless.response);
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
    expect(endless.cancelled()).toBe(true);
    // A few chunks past the ceiling at most, not "as many as it had".
    expect(endless.pulls()).toBeLessThanOrEqual(
      MAX_BODY_BYTES / (64 * 1024) + 2
    );
  });

  it('is refused before a byte is read when its length is declared', async () => {
    const endless = endlessResponse();
    endless.response.headers.set('content-length', String(MAX_BODY_BYTES + 1));
    stubFetch(() => endless.response);
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toThrow(
      `${MAX_BODY_BYTES + 1} declared`
    );
    // The stream primes one chunk on its own; nothing asked for a second.
    expect(endless.pulls()).toBeLessThanOrEqual(1);
    expect(endless.cancelled()).toBe(true);
  });

  it('under an error status is cut, and the status is the answer', async () => {
    // 6.5: the status decides before the body is read. A proxy answering a
    // `401` with a page that never ends used to surface as "too large".
    const endless = endlessResponse(401);
    stubFetch(() => endless.response);
    const api = new WgEasyApi(testConfig());

    const error = await api.get('/api/client').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WgEasyApiError);
    expect((error as WgEasyApiError).status).toBe(401);
    expect((error as WgEasyApiError).body.length).toBe(64 * 1024);
    expect(endless.cancelled()).toBe(true);
  });

  it('that breaks off under a success status fails the call', async () => {
    // The other side of the case below. A connection reset half way through a
    // 200 is not a smaller answer, it is an unfinished one — so it has to reach
    // the caller as a failure rather than as a truncated client list that looks
    // complete.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    stubFetch(
      () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toThrow('connection reset');
  });

  it('a body that breaks off under an error status is still that status', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    stubFetch(() => new Response(stream, { status: 502 }));
    const api = new WgEasyApi(testConfig());

    const error = await api.get('/api/client').catch((e: unknown) => e);

    expect((error as WgEasyApiError).status).toBe(502);
    expect((error as WgEasyApiError).body).toBe('');
  });
});

describe('a refused login', () => {
  it('is repeated from memory for ten seconds rather than retried', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    const calls = stubFetch(
      () => new Response('{"message":"unauthorized"}', { status: 401 })
    );
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toThrow('HTTP 401');
    vi.setSystemTime(new Date('2026-09-07T12:00:04Z'));
    const second = await api.get('/api/client').catch((e: unknown) => e);

    expect(calls).toHaveLength(1);
    expect((second as WgEasyApiError).status).toBe(401);
    expect((second as Error).message).toContain('repeated from memory');
    expect((second as Error).message).toContain('4 s ago');
    expect((second as Error).message).toContain('2026-09-07T12:00:10.000Z');
    // The remembered body still reaches the caller.
    expect((second as WgEasyApiError).body).toContain('unauthorized');
  });

  it('is tried again once the memory has lapsed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    let attempts = 0;
    const calls = stubFetch(() =>
      attempts++ === 0
        ? new Response('no', { status: 401 })
        : new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
    );
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toThrow('HTTP 401');
    vi.setSystemTime(new Date('2026-09-07T12:00:10Z'));

    await expect(api.get('/api/client')).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('is not what a 403 leaves behind', async () => {
    const calls = stubFetch(() => new Response('no', { status: 403 }));
    const api = new WgEasyApi(testConfig());

    await expect(api.get('/api/client')).rejects.toThrow('HTTP 403');
    await expect(api.get('/api/client')).rejects.toThrow('HTTP 403');
    expect(calls).toHaveLength(2);
  });
});
