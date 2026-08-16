import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { WgEasyApi } from '../api.js';
import { run, upstreamJsonResult } from '../result.js';

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

/**
 * The admin endpoints return the raw server configuration, which depending on
 * the wg-easy version includes the WireGuard server private key and other
 * secrets. Those must never reach the model context.
 */
function redactSecrets(value: unknown): unknown {
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

export function registerServerInfoTools(
  server: McpServer,
  api: WgEasyApi
): void {
  server.registerTool(
    'get_server_info',
    {
      title: 'Get wg-easy server info',
      description:
        'Get information about the wg-easy instance: release/update status, general settings and the WireGuard interface configuration. Secret fields (private keys, passwords) are redacted.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        // /api/information can fail server-side (it fetches the latest
        // release from GitHub), so collect each section independently.
        const sections = {
          information: '/api/information',
          general: '/api/admin/general',
          interface: '/api/admin/interface',
        } as const;

        const result: Record<string, unknown> = {};
        for (const [key, path] of Object.entries(sections)) {
          try {
            result[key] = redactSecrets(await api.get(path));
          } catch (error) {
            result[key] = {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return upstreamJsonResult(
          result,
          'Query a single section directly through the wg-easy UI if it was cut off.'
        );
      })
  );
}
