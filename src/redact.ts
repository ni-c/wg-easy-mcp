/**
 * Removes secrets from anything the wg-easy API hands back.
 *
 * wg-easy returns key material in full, in more places than is obvious. The
 * admin endpoints carry the WireGuard **server** private key and the argon2
 * hash of the metrics token; the client endpoints carry each client's **own**
 * private key and pre-shared key. All of it would otherwise land in the model's
 * context and therefore in the transcript, where it outlives any decision to
 * stop using it.
 *
 * `get_client_config` exists for the case where somebody genuinely wants a
 * client's key: it returns the configuration file, deliberately, on request.
 * Nothing else needs to.
 */

/**
 * A key is sensitive by what it **ends in**, on the key with `_` and `-`
 * removed and lower-cased.
 *
 * It used to be an exact list, and `metricsPassword` is what that costs:
 * `GET /api/admin/general` carries the argon2 hash of the metrics token under
 * that name, `password` matched `password` and not `metricsPassword`, and the
 * hash went out through a tool whose own description promises that passwords
 * are redacted. Every `<prefix><Secret>` the instance invents is the same
 * finding waiting to happen, and the suffix rule is what makes the answer not
 * depend on wg-easy's naming.
 *
 * `key` is deliberately **not** in the list: it would take `sshKey` and every
 * other `*_key` identifier with it. `publicKey` has to survive — it is how a
 * peer is identified, and it is public.
 */
const SENSITIVE_SUFFIXES = [
  'password',
  'passwordhash',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'presharedkey',
];

/**
 * Keys that are a secret only when they hold the secret *itself*.
 *
 * `oneTimeLink` is both a joined object — `{ oneTimeLink, expiresAt, … }` — and,
 * one level down, the token that URL is made of. The token is a bearer
 * credential: `GET /cnf/<token>` returns the client's whole configuration,
 * private key included, with no login at all. wg-easy puts it on every row of
 * `GET /api/client`, so `list_clients` — a read tool, ungated, alive under
 * `WG_EASY_READ_ONLY` — used to hand out a working download URL for any client
 * whose link had not yet expired.
 *
 * Only the string is replaced, so the surrounding row still says that a link is
 * live and when it lapses. Reporting that is useful; carrying the token is not.
 * `generate_one_time_link` reads the API's answer before this filter runs,
 * because handing over the link is what somebody just approved.
 */
const SENSITIVE_STRING_KEYS = new Set(['onetimelink']);

/** The key as it is matched: separators removed, lower-cased. */
function normalizeKey(key: string): string {
  return key.replaceAll('_', '').replaceAll('-', '').toLowerCase();
}

function isSensitiveKey(key: string, value: unknown): boolean {
  const normalized = normalizeKey(key);
  if (normalized.startsWith('totp')) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  return typeof value === 'string' && SENSITIVE_STRING_KEYS.has(normalized);
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === 'object') {
    // `Object.fromEntries`, not `out[key] = …`: `__proto__` is legal JSON and
    // an own property after `JSON.parse`, and assigning to it through a
    // variable key runs the `Object.prototype` setter — the field is dropped
    // and the prototype of what leaves this function is replaced by whatever
    // the instance sent. `fromEntries` defines every key as an own property.
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveKey(key, entry) ? '[redacted]' : redactSecrets(entry),
      ])
    );
  }
  return value;
}
