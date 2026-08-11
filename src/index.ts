#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'wg-easy-mcp: WG_EASY_INSECURE_TLS=true — TLS certificate validation is disabled for the wg-easy connection'
    );
  }

  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`wg-easy-mcp: connected, targeting ${config.url}`);
}

main().catch((error: unknown) => {
  console.error('wg-easy-mcp: fatal error:', error);
  process.exit(1);
});
