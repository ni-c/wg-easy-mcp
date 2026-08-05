import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WgEasyApiError } from './api.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Runs a tool handler and converts thrown errors into MCP error results
 * instead of protocol-level failures.
 */
export async function run(
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WgEasyApiError) {
      let hint = '';
      if (error.status === 401) {
        hint =
          '\nHint: check WG_EASY_USERNAME/WG_EASY_PASSWORD. Note that the wg-easy API only supports Basic Authentication and does not work while 2FA (TOTP) is enabled for the account.';
      }
      return errorResult(`${error.message}\n${error.body}${hint}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`wg-easy-mcp: ${message}`);
  }
}
