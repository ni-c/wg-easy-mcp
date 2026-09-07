import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import {
  missingConfigKeys,
  missingConfigMessage,
  type Config,
} from './config.js';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Ceiling for a successful response body.
 *
 * Read from wg-easy's own largest answer: a client record is a few hundred
 * bytes, and an instance with ten thousand peers — far past what one WireGuard
 * interface serves — is a couple of megabytes. Eight is room for that and a
 * bound for everything else.
 *
 * The bound matters because the other end is not always wg-easy. Under
 * `WG_EASY_INSECURE_TLS` any host that answers on the address is trusted, and a
 * `WG_EASY_URL` with a typo in it reaches whoever owns that name. `await
 * response.text()` on a body that never ends is a process that never answers
 * again — no error, no timeout (the request signal is spent once the headers
 * arrive), just a server that has stopped.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling for the body of a *failed* response, which is cut rather than
 * refused.
 *
 * Different from the one above because the two are needed for different things.
 * A success is the answer, so an oversized one has to be refused — there is no
 * smaller true answer. A failure is a diagnostic; the status is what matters and
 * the body is a hint, so a reverse proxy's two-megabyte login page under a `401`
 * should be cut down to the hint, not turned into "the response was too large",
 * which is the wrong sentence and hides the credential problem behind it.
 */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * How long a refused login is repeated from memory instead of being tried
 * again.
 *
 * The wg-easy API takes the admin credentials on every single request, so every
 * tool call is a login attempt. `401` is also the one answer that makes a model
 * retry — it reads as "transient" — and a retry loop against an instance behind
 * fail2ban bans the address the server calls from, which is the host the
 * operator administers the VPN from.
 */
const REFUSED_LOGIN_MEMORY_MS = 10_000;

export class WgEasyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string,
    note?: string
  ) {
    super(
      `wg-easy API ${method} ${path} failed with HTTP ${status}` +
        (note === undefined ? '' : ` — ${note}`)
    );
    this.name = 'WgEasyApiError';
  }
}

/** Raised when a response body passes {@link MAX_BODY_BYTES}. */
export class ResponseTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * The part of a response this file reads.
 *
 * Spelled out rather than taken from either `Response`: undici's and the global
 * one are structurally incompatible in the type system, and this code path is
 * reached through both — the global `fetch` normally, undici's under the
 * insecure-TLS switch.
 */
interface BodyLike {
  headers: { get(name: string): string | null };
  body: { getReader(): BodyReaderLike; cancel(): Promise<void> } | null;
  text(): Promise<string>;
}

interface BodyReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}

/** The `content-length` header as a number, when it is one. */
function declaredLength(response: BodyLike): number | undefined {
  const raw = response.headers.get('content-length');
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Reads a body under a ceiling.
 *
 * `refuse` is for the success path: a declared length past the ceiling is
 * refused before a byte is read, and a body that grows past it while being read
 * cancels the reader. `cut` is for the error path, which never refuses — the
 * status is the answer there, and a body that breaks off mid-stream is still
 * that status.
 */
async function readBounded(
  response: BodyLike,
  cap: number,
  overflow: 'refuse' | 'cut'
): Promise<string> {
  if (overflow === 'refuse') {
    const declared = declaredLength(response);
    if (declared !== undefined && declared > cap) {
      await response.body?.cancel().catch(() => {});
      throw new ResponseTooLargeError(
        `The wg-easy instance answered with ${declared} declared bytes, past ` +
          `the ${cap}-byte ceiling. Nothing was read.`
      );
    }
  }

  const stream = response.body;
  // No stream to read: a 204, or a Response built without one. `text()` on it
  // resolves immediately with the empty string.
  if (stream === null) return response.text();

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    let chunk: { done: boolean; value?: Uint8Array | undefined };
    try {
      chunk = await reader.read();
    } catch (error) {
      // The connection broke. On the error path that is not an error of its
      // own — the status already is the answer — so keep what arrived.
      if (overflow === 'cut') break;
      throw error;
    }
    if (chunk.done) break;
    const value = chunk.value;
    if (value === undefined) continue;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes > cap) {
      await reader.cancel().catch(() => {});
      if (overflow === 'refuse') {
        throw new ResponseTooLargeError(
          `The wg-easy instance answered with more than the ${cap}-byte ` +
            'ceiling and the rest was not read. Narrow the request — a name ' +
            'filter on list_clients, or get_client for one peer.'
        );
      }
      return text.slice(0, cap);
    }
  }
  text += decoder.decode();
  return overflow === 'cut' ? text.slice(0, cap) : text;
}

/** What a refused login left behind, for {@link REFUSED_LOGIN_MEMORY_MS}. */
interface RefusedLogin {
  at: number;
  body: string;
}

/**
 * Minimal client for the wg-easy v15 REST API.
 *
 * The API uses HTTP Basic Authentication with the same credentials as the
 * web UI. Note that the API does not work while 2FA (TOTP) is enabled for
 * the account.
 */
export class WgEasyApi {
  private readonly config: Config;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  /**
   * Only set when `WG_EASY_INSECURE_TLS` is enabled. Scopes the relaxed
   * certificate validation to requests against the configured wg-easy host
   * instead of disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;
  /** The last refused login, while it is still being repeated from memory. */
  private refusedLogin: RefusedLogin | undefined;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.url ?? '';
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString(
        'base64'
      );
    if (config.insecureTls) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    // The credentials are only required here, not at startup, so that the
    // server can still be started and introspected without them.
    const missing = missingConfigKeys(this.config);
    if (missing.length > 0) {
      throw new Error(missingConfigMessage(missing));
    }

    const refused = this.rememberedRefusal();
    if (refused !== undefined) throw this.refusalError(refused, method, path);

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json, text/plain, */*',
    };
    const init: RequestInit = {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${path}`;
    // The insecure dispatcher requires undici's own fetch; the default path
    // uses the (stubbable) global fetch.
    const response = (this.insecureDispatcher
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init)) as unknown as BodyLike & {
      ok: boolean;
      status: number;
    };

    // The status decides before the body is read. The other order made a `401`
    // behind a reverse proxy's login page surface as "the response was too
    // large" — the size instead of the credential problem, and an error type
    // that nothing downstream recognises as a status.
    if (!response.ok) {
      const errorBody = await readBounded(
        response,
        MAX_ERROR_BODY_BYTES,
        'cut'
      );
      if (response.status === 401) {
        this.refusedLogin = { at: Date.now(), body: errorBody };
      }
      throw new WgEasyApiError(response.status, errorBody, method, path);
    }

    const text = await readBounded(response, MAX_BODY_BYTES, 'refuse');

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  /** The refusal still inside its window, if there is one. */
  private rememberedRefusal(): RefusedLogin | undefined {
    const refused = this.refusedLogin;
    if (refused === undefined) return undefined;
    if (Date.now() - refused.at >= REFUSED_LOGIN_MEMORY_MS) {
      this.refusedLogin = undefined;
      return undefined;
    }
    return refused;
  }

  /**
   * The remembered `401`, as the error the caller would have got.
   *
   * Same type, same status and same body as the real one — a caller must not
   * have to know that this answer came from memory to handle it — with a note
   * saying so, because a model that reads "401" twice in a row and cannot see
   * that the second one cost no request will keep going.
   */
  private refusalError(
    refused: RefusedLogin,
    method: string,
    path: string
  ): WgEasyApiError {
    const ago = Math.round((Date.now() - refused.at) / 1000);
    const next = new Date(refused.at + REFUSED_LOGIN_MEMORY_MS).toISOString();
    return new WgEasyApiError(
      401,
      refused.body,
      method,
      path,
      `the login was refused ${ago} s ago and this answer is repeated from ` +
        `memory, not retried. The next attempt is possible at ${next}. ` +
        'Retrying a refused login is how an address ends up banned; fix ' +
        'WG_EASY_USERNAME/WG_EASY_PASSWORD instead.'
    );
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }
}
