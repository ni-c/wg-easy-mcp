import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { WgEasyApi } from '../api.js';
import { jsonResult, run } from '../result.js';

export function registerServerInfoTools(
  server: McpServer,
  api: WgEasyApi
): void {
  server.registerTool(
    'get_server_info',
    {
      title: 'Get wg-easy server info',
      description:
        'Get information about the wg-easy instance: release/update status, general settings and the WireGuard interface configuration.',
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
            result[key] = await api.get(path);
          } catch (error) {
            result[key] = {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return jsonResult(result);
      })
  );
}
