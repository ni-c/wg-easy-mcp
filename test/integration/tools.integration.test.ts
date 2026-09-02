import {
  expectEveryToolExercised,
  startServer,
  toolCoverage,
  tokenOf,
  type LiveHarness,
} from 'mcp-integration-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/catalogue.js';
import { bootstrap, USERNAME, type Sandbox } from './bootstrap.js';

/**
 * Every tool in the catalogue, against a real wg-easy in Docker.
 *
 * What only a real instance can show is that a client is a **WireGuard peer**
 * rather than a row: creating one generates a key pair, and the configuration
 * and QR code the read tools hand out are generated from it. A stub returning
 * a fixture agrees with any key handling at all.
 *
 * Nearly every tool here is guarded — twelve confirmation sites in one file —
 * so both halves are driven: one harness answers the dialog, a second takes
 * the two-call token.
 */

let sandbox: Sandbox;
/** Declares elicitation, so guarded tools go through the real dialog. */
let asking: LiveHarness;
/** Declares none, so the same tools fall back to the two-call token. */
let plain: LiveHarness;

let clientId: number;

/**
 * Payloads are prefixed with the untrusted-data marker, which **starts with a
 * bracket** — `[untrusted data] …` — so looking for the first `[` finds the
 * disclaimer rather than the JSON. The marker is separated by a blank line;
 * that is what to split on.
 */
function parse<T>(text: string): T {
  const blank = text.indexOf('\n\n');
  return JSON.parse(blank === -1 ? text : text.slice(blank + 2)) as T;
}

interface Client {
  /** Numeric, despite the name. */
  id: number;
  name: string;
  enabled: boolean;
  publicKey?: string;
}

beforeAll(async () => {
  sandbox = await bootstrap();
  asking = await startServer({ env: sandbox.env, elicit: 'accept' });
  plain = await startServer({ env: sandbox.env });
}, 600_000);

afterAll(async () => {
  await asking?.close();
  await plain?.close();
});

describe('the instance', () => {
  it('reports what it is, without the private key', async () => {
    const info = await asking.call('get_server_info');
    expect(info).toContain('"currentRelease"');
    expect(info).toContain('"interface"');
    // The redaction, against a real instance rather than a fixture: wg-easy's
    // admin endpoints really do return the interface private key, and this
    // server really must not pass it on.
    expect(info).not.toMatch(/"privateKey":\s*"[A-Za-z0-9+/]{40,}/);
    expect(info).not.toContain(sandbox.env.WG_EASY_PASSWORD);
  });

  it('starts with no clients at all', async () => {
    // A bare array, not wrapped in an object.
    const listed = parse<Client[]>(await asking.call('list_clients'));
    expect(listed).toHaveLength(0);
  });
});

describe('a client through its whole life', () => {
  it('creates one, which generates a real key pair', async () => {
    await asking.call('create_client', { name: 'integration-laptop' });

    const listed = parse<(Client & { privateKey?: string })[]>(
      await asking.call('list_clients')
    );
    expect(listed).toHaveLength(1);
    clientId = listed[0]!.id;
    expect(listed[0]!.name).toBe('integration-laptop');
    // The list endpoint does not carry the private key at all — only the
    // single-client read does, which is what made the leak easy to miss.
    expect(listed[0]!.privateKey).toBeUndefined();
    expect(listed[0]!.publicKey).toBeDefined();

    const one = parse<Client & { privateKey?: string }>(
      await asking.call('get_client', { clientId })
    );
    expect(one.name).toBe('integration-laptop');

    // Found by this suite and fixed: wg-easy returns each client's own
    // private key and pre-shared key in full, and only `get_server_info` used
    // to redact. The key now never leaves the process — `get_client_config`
    // exists for the case where somebody genuinely wants it, deliberately and
    // on request.
    expect(one.privateKey).toBe('[redacted]');
  });

  it('hands out a configuration generated from that key pair', async () => {
    // Not a fixture: wg-easy built this from the peer it created, so the
    // interface block and the server's public key are both real.
    const config = await asking.call('get_client_config', { clientId });
    expect(config).toContain('[Interface]');
    expect(config).toContain('[Peer]');
    expect(config).toContain('PrivateKey');
    expect(config).toContain('AllowedIPs');
  });

  it('renders the same configuration as an SVG, returned as text', async () => {
    // Text rather than an image part: wg-easy serves `qrcode.svg`, and an SVG
    // is a document. A client that renders markup shows it; one that does not
    // shows the source, which is why the tool does not pretend it is a PNG.
    const qr = await asking.call('get_client_qrcode', { clientId });
    expect(qr).toContain('<svg');
    expect(qr.length).toBeGreaterThan(1000);
  });

  it('disables and re-enables it', async () => {
    await asking.call('disable_client', { clientId });
    let listed = parse<Client[]>(await asking.call('list_clients'));
    expect(listed[0]!.enabled).toBe(false);

    await asking.call('enable_client', { clientId });
    listed = parse<Client[]>(await asking.call('list_clients'));
    expect(listed[0]!.enabled).toBe(true);
  });

  it('renames it, merging into the state it already had', async () => {
    // `update_client` takes partial input and has to merge — sending only the
    // name must not blank the expiry or the enabled flag, which is exactly the
    // kind of thing a stub cannot notice.
    await asking.call('update_client', {
      clientId,
      name: 'integration-phone',
    });
    const listed = parse<Client[]>(await asking.call('list_clients'));
    expect(listed[0]!.name).toBe('integration-phone');
    expect(listed[0]!.enabled).toBe(true);
  });

  it('mints a link that really downloads the configuration, unauthenticated', async () => {
    // **A finding, and the previous reading of it was wrong.** This assertion
    // used to be `toContain('not returned by the API')`, explained by a
    // comment saying wg-easy 15.4.0 answers HTTP 500 here. It does not: the
    // POST answers 200 and writes the row. What is true is that wg-easy joins
    // the link onto the client in `findMany` only — so the single-client read
    // this tool used answered `null`, and the server reported a failure while
    // an unauthenticated download URL was live for five minutes.
    //
    // Only a real instance can settle that, which is why the check is here and
    // not in the stubbed suite: the link is fetched with **no credentials at
    // all** and has to hand back the peer's private key.
    const text = await asking.call('generate_one_time_link', { clientId });
    const { oneTimeLink, path } = parse<{
      oneTimeLink: string;
      path: string;
    }>(text);
    expect(oneTimeLink).toMatch(/^[0-9a-f]+$/);
    expect(path).toBe(`/cnf/${oneTimeLink}`);

    const anonymous = await fetch(`${sandbox.url}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    expect(anonymous.status).toBe(200);
    expect(await anonymous.text()).toContain('PrivateKey');
  });

  it('does not put that link into list_clients', async () => {
    // The same token, seen from the read side. `list_clients` is ungated, is
    // in the essential preset and survives `WG_EASY_READ_ONLY`, and wg-easy
    // puts the one-time link on every row of `GET /api/client` — so the read
    // path used to hand out the download URL the test above just used.
    const listed = parse<{ oneTimeLink?: { oneTimeLink?: string } | null }[]>(
      await asking.call('list_clients')
    );
    const row = listed.find((entry) => entry.oneTimeLink != null);
    expect(row?.oneTimeLink?.oneTimeLink).toBe('[redacted]');
  });

  it('names the client in the dialog, not just its id', async () => {
    // The person answering has to be able to tell which VPN client this is.
    expect(asking.prompts.join('\n')).toContain('integration-phone');
  });
});

describe('the fallback path for a client with no dialog', () => {
  it('creates only after the token comes back', async () => {
    const refusal = await plain.call('create_client', {
      name: 'integration-tablet',
    });
    expect(refusal).toContain('confirm_token');
    expect(plain.prompts).toHaveLength(0);
    // Nothing yet: the first call is a question.
    let listed = parse<Client[]>(await plain.call('list_clients'));
    expect(listed).toHaveLength(1);

    await plain.call('create_client', {
      name: 'integration-tablet',
      confirm_token: tokenOf(refusal),
    });
    listed = parse<Client[]>(await plain.call('list_clients'));
    expect(listed).toHaveLength(2);
  });

  it('deletes only after the token comes back, and refuses a stale one', async () => {
    const listed = parse<Client[]>(await plain.call('list_clients'));
    const tablet = listed.find((c) => c.name === 'integration-tablet')!;

    const refusal = await plain.call('delete_client', {
      clientId: tablet.id,
    });
    const token = tokenOf(refusal);

    // A token issued for one client must not delete another. Naming the
    // reason rather than passing a bare `true`: `expectError: true` is also
    // satisfied by a schema rejection, so a renamed argument would keep this
    // green while the guard it is about is never reached.
    await plain.call(
      'delete_client',
      { clientId, confirm_token: token },
      { expectError: 'was issued for different arguments' }
    );
    await plain.call('get_client', { clientId });

    await plain.call('delete_client', {
      clientId: tablet.id,
      confirm_token: token,
    });
    const after = parse<Client[]>(await plain.call('list_clients'));
    expect(after.map((c) => c.name)).not.toContain('integration-tablet');
  });

  it('asked a person on one harness and nobody on the other', () => {
    expect(asking.prompts.length).toBeGreaterThan(0);
    expect(plain.prompts).toHaveLength(0);
  });
});

describe('cleaning up', () => {
  it('deletes the client it made', async () => {
    await asking.call('delete_client', { clientId });
    // A bare array, not wrapped in an object.
    const listed = parse<Client[]>(await asking.call('list_clients'));
    expect(listed).toHaveLength(0);
  });
});

it('exercises every tool in the catalogue', () => {
  const called = new Set([...asking.called, ...plain.called]);
  const report = toolCoverage({ called }, ALL_TOOLS, {});
  console.log(
    `wg-easy-mcp: ${report.called.length}/${ALL_TOOLS.length} tools against a real wg-easy (admin ${USERNAME})`
  );
  expectEveryToolExercised({ called }, ALL_TOOLS, {});
});
