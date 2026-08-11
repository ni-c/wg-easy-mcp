import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import type { Config } from './config.js';

const REQUEST_TIMEOUT_MS = 15_000;

export class WgEasyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
  ) {
    super(`wg-easy API ${method} ${path} failed with HTTP ${status}`);
    this.name = 'WgEasyApiError';
  }
}

/**
 * Minimal client for the wg-easy v15 REST API.
 *
 * The API uses HTTP Basic Authentication with the same credentials as the
 * web UI. Note that the API does not work while 2FA (TOTP) is enabled for
 * the account.
 */
export class WgEasyApi {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  /**
   * Only set when `WG_EASY_INSECURE_TLS` is enabled. Scopes the relaxed
   * certificate validation to requests against the configured wg-easy host
   * instead of disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;

  constructor(config: Config) {
    this.baseUrl = config.url;
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.username}:${config.password}`).toString('base64');
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
    const response = this.insecureDispatcher
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      throw new WgEasyApiError(response.status, text, method, path);
    }

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
