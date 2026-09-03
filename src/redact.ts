/**
 * Removes secrets from anything the wg-easy API hands back.
 *
 * wg-easy returns key material in full, in more places than is obvious. The
 * admin endpoints carry the WireGuard **server** private key; the client
 * endpoints carry each client's **own** private key and pre-shared key. All of
 * it would otherwise land in the model's context and therefore in the
 * transcript, where it outlives any decision to stop using it.
 *
 * `get_client_config` exists for the case where somebody genuinely wants a
 * client's key: it returns the configuration file, deliberately, on request.
 * Nothing else needs to.
 */

const SENSITIVE_KEYS = new Set([
  'privatekey',
  'presharedkey',
  'password',
  'passwordhash',
  'sessionsecret',
]);

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

function isSensitiveKey(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower) || lower.startsWith('totp')) return true;
  return typeof value === 'string' && SENSITIVE_STRING_KEYS.has(lower);
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = isSensitiveKey(key, entry)
        ? '[redacted]'
        : redactSecrets(entry);
    }
    return redacted;
  }
  return value;
}
