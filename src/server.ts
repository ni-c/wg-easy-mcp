import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WgEasyApi } from './api.js';
import { buildToolFilter, installToolFilter } from './tool-filter.js';
import type { Config } from './config.js';
import { registerClientTools } from './tools/clients.js';
import { registerServerInfoTools } from './tools/server-info.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  // Before anything is built: an unusable tool list should fail on the
  // way in, not leave a server running with tools quietly missing.
  const filter = buildToolFilter(config);

  const api = new WgEasyApi(config);

  const server = new McpServer({
    name: 'wg-easy-mcp',
    version: packageVersion(),
  });

  // Wraps server.registerTool, so it has to sit before the first
  // register call and does not care how they are organised.
  installToolFilter(server, filter);

  registerClientTools(server, api);
  registerServerInfoTools(server, api);

  return server;
}
