import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WgEasyApi } from './api.js';
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
  const api = new WgEasyApi(config);

  const server = new McpServer({
    name: 'wg-easy-mcp',
    version: packageVersion(),
  });

  registerClientTools(server, api);
  registerServerInfoTools(server, api);

  return server;
}
