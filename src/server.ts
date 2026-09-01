import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';

import { ConfirmationStore, createApproval } from 'mcp-approval';
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

import { WgEasyApi } from './api.js';
import type { Config } from './config.js';
import { ALL_TOOLS, ESSENTIAL_TOOLS, READ_TOOLS } from './tools/catalogue.js';
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
  //
  // `activatesFilter` is what makes read-only mode work here at all: this
  // server implements it *through* the filter rather than through a
  // registration gate, because `registerClientTools` registers the read and
  // the write tools together. So a closed gate has to switch the filter on by
  // itself, with neither list set.
  const filter = buildToolFilter({
    allowTools: config.allowTools,
    denyTools: config.denyTools,
    catalogue: {
      all: ALL_TOOLS,
      essential: ESSENTIAL_TOOLS,
      ungated: READ_TOOLS,
    },
    names: {
      allow: 'WG_EASY_ALLOW_TOOLS',
      deny: 'WG_EASY_DENY_TOOLS',
      server: 'wg-easy-mcp',
    },
    gate: {
      closed: config.readOnly,
      variable: 'WG_EASY_READ_ONLY',
      noun: 'read-only mode',
      activatesFilter: true,
    },
  });

  const api = new WgEasyApi(config);
  const confirmations = new ConfirmationStore();
  // One approver per server: it holds the key that seals the request state
  // carried out through the client and back.
  const approval = createApproval({
    server: 'wg-easy-mcp',
    elicitation: config.elicitation,
  });

  const server = new McpServer({
    name: 'wg-easy-mcp',
    version: packageVersion(),
  });

  // Wraps server.registerTool, so it has to sit before the first
  // register call and does not care how they are organised.
  installToolFilter(server, filter);

  registerClientTools(server, api, confirmations, approval);
  registerServerInfoTools(server, api);

  return server;
}
