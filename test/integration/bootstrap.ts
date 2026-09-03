import { assertLoopback, waitForHttp } from 'mcp-integration-harness';

/**
 * Brings the throwaway wg-easy from first start to a usable API.
 *
 * wg-easy 15 has a **setup wizard** and no environment variable that skips it,
 * so the bootstrap posts the two steps the wizard posts. They are numbered
 * 2 and 4; 1, 3, 5 and 6 are 404s, because the numbering counts screens and
 * not endpoints.
 *
 * **2FA stays off**, and that is not a preference. The wg-easy API supports
 * Basic Authentication only, so an account with TOTP enabled cannot be used by
 * this server at all — the credentials are accepted and every call then fails.
 */

export const USERNAME = 'integration';
/** wg-easy enforces a minimum length; this is comfortably over it. */
export const PASSWORD = 'integration-not-a-secret-12';

export interface Sandbox {
  url: string;
  env: Record<string, string>;
}

async function post(
  url: string,
  path: string,
  body: object
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, text: await response.text() };
}

export async function bootstrap(
  url = 'http://127.0.0.1:51821'
): Promise<Sandbox> {
  assertLoopback(url);
  // Answers a redirect to /setup/1 until the wizard is done, so any response
  // means the process is listening.
  await waitForHttp(url, { timeoutSeconds: 180 });

  const admin = await post(url, '/api/setup/2', {
    username: USERNAME,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  if (admin.status >= 400) {
    throw new Error(
      `wg-easy refused to create the admin account (HTTP ${admin.status}): ` +
        `${admin.text.slice(0, 300)}. On a fresh instance this should work; ` +
        'if this one is already set up, run `docker compose -f ' +
        'test/integration/compose.yml down -v` and up again.'
    );
  }

  const iface = await post(url, '/api/setup/4', {
    host: '127.0.0.1',
    port: 51820,
  });
  if (iface.status >= 400) {
    throw new Error(
      `wg-easy refused the interface settings (HTTP ${iface.status}): ` +
        `${iface.text.slice(0, 300)}`
    );
  }

  // The API answering is the readiness signal, not the wizard finishing.
  // `GET /api/client` is a 500 while the WireGuard interface is down —
  // `wg show wg0 dump` reports no such device — and that failure is remote
  // enough from its cause to be worth catching here rather than in a tool.
  const probe = await fetch(`${url}/api/client`, {
    headers: { authorization: basic(USERNAME, PASSWORD) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!probe.ok) {
    throw new Error(
      `wg-easy's client API answered HTTP ${probe.status} after setup. A 500 ` +
        'usually means the wg0 interface never came up: `wg-quick` writes its ' +
        'rules with iptables, and the image defaults to iptables-legacy, ' +
        'which needs the ip_tables kernel module. See the note in ' +
        'compose.yml. `docker compose logs` shows the wg-quick line.'
    );
  }

  return {
    url,
    env: {
      WG_EASY_URL: url,
      WG_EASY_USERNAME: USERNAME,
      WG_EASY_PASSWORD: PASSWORD,
      // Defaults to true in this server; the suite exists to drive the writes.
      WG_EASY_READ_ONLY: 'false',
    },
  };
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
