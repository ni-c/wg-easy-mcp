import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { WgEasyApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { redactSecrets } from '../redact.js';
import { run, upstreamResult } from '../result.js';
import { untrustedFields } from '../output-schema.js';

/**
 * A section of the answer, or the note saying why it is absent.
 *
 * A union rather than an optional field: /api/information fetches the latest
 * release from GitHub and can fail on its own, and the tool's whole design is
 * that one failed section does not fail the call. "Not fetched" and "fetched
 * and empty" are different answers.
 *
 * The `meta` is not decoration. Left to itself zod writes "accepts anything" as
 * `"additionalProperties": {}` — an empty schema, legal and meaning exactly the
 * same as `true`, but the spelling some MCP clients refuse or mishandle.
 */
const section = z.union([
  z.looseObject({}).meta({ additionalProperties: true }),
  z.object({ error: z.string() }),
]);

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
      inputSchema: z.object({}),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        information: section.describe('Release and update status.'),
        general: section.describe('Instance-wide settings.'),
        interface: section.describe('The WireGuard interface configuration.'),
      }),
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
        return upstreamResult(
          result,
          'Query a single section directly through the wg-easy UI if it was cut off.'
        );
      })
  );
}
