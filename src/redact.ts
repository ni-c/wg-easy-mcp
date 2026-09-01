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

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || lower.startsWith('totp');
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = isSensitiveKey(key) ? '[redacted]' : redactSecrets(entry);
    }
    return redacted;
  }
  return value;
}
