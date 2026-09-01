import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { WgEasyApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { redactSecrets } from '../redact.js';
import { run, upstreamJsonResult } from '../result.js';

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
