import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { WgEasyApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { cleanRecord, cleanText, kindOf } from '../boundary.js';
import { redactSecrets } from '../redact.js';
import { run, upstreamResult } from '../result.js';
import { truncationNote, untrustedFields } from '../output-schema.js';

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
        // Three sections of settings, each of which the instance can make
        // arbitrarily long — so the budget can shorten this answer, and a
        // `z.object` that does not name the field it attaches refuses the whole
        // result for any client that has loaded `tools/list`. Found by the
        // property test, not by reading: the two file tools had been given the
        // field and this one was written in another file.
        truncated: truncationNote,
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
            const answer = redactSecrets(await api.get(path));
            // A section has to be an object: the schema above says so, and one
            // section that is a string — a maintenance page, an HTML body a
            // proxy served under 200 — used to fail the whole call, which is
            // the one thing this tool's per-section design exists to prevent.
            // Named, not swallowed: `error` is a legitimate value of a section.
            result[key] =
              answer !== null &&
              typeof answer === 'object' &&
              !Array.isArray(answer)
                ? cleanRecord(answer)
                : {
                    error:
                      `The wg-easy instance answered ${kindOf(answer)} for ` +
                      `${path}, where a settings object was expected.`,
                  };
          } catch (error) {
            // This sentence is mostly the server's own ("… failed with HTTP
            // 500"), but not entirely: a TLS failure names what the certificate
            // claimed, and undici quotes values back. Cleaned and cut, not
            // labelled — the label belongs on a body, not on a diagnostic.
            const message =
              error instanceof Error ? error.message : String(error);
            result[key] = { error: cleanText(message).slice(0, 500) };
          }
        }
        return upstreamResult(
          result,
          'Query a single section directly through the wg-easy UI if it was cut off.'
        );
      })
  );
}
