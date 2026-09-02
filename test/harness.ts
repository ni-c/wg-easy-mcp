import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { expect, vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    url: 'http://wg.test:51821',
    username: 'admin',
    password: 'secret',
    insecureTls: false,
    readOnly: false,
    elicitation: true,
    allowTools: undefined,
    denyTools: undefined,
    ...overrides,
  };
}

export type FetchCall = { url: string; init: RequestInit | undefined };

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

/** Stubs global fetch and records all calls. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    })
  );
  return calls;
}

/** How a client that can show a dialog answers it. */
export type ElicitBehaviour = 'accept' | 'decline' | 'cancel';

/**
 * Connects a client to the real server.
 *
 * Without `elicit` the client declares no elicitation capability, which is the
 * case the two-call token exists for and what most of the suite drives. With
 * it, the client answers the dialog and `prompts` records what the server put
 * in front of the user.
 */
export async function connect(
  overrides: Partial<Config> = {},
  elicit?: ElicitBehaviour
): Promise<Client & { prompts: string[] }> {
  const server = createServer(testConfig(overrides));
  const prompts: string[] = [];
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    elicit === undefined ? {} : { capabilities: { elicitation: {} } }
  );
  if (elicit !== undefined) {
    client.setRequestHandler('elicitation/create', (request) => {
      prompts.push((request.params as { message?: string }).message ?? '');
      if (elicit === 'cancel') return { action: 'cancel' };
      if (elicit === 'decline') return { action: 'decline' };
      return { action: 'accept', content: { confirm: true } };
    });
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return Object.assign(client, { prompts });
}

/** The tools a server built with this configuration actually offers. */
export async function toolNames(
  overrides: Partial<Config> = {}
): Promise<string[]> {
  const client = await connect(overrides);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name).sort();
}

export function resultText(result: CallToolResult): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * The machine-readable half of a result — and a check that the other half says
 * the same thing.
 *
 * The specification's rule is that `content` and `structuredContent` are the
 * same information in two presentations, and nothing enforces it: a tool that
 * builds the two separately can drift between them for a long time before
 * anybody notices, because each channel looks right to whoever reads only that
 * one. Every assertion in this suite goes through here, so every one of them
 * also asserts the two agree.
 *
 * Payloads from the wg-easy API are prefixed with the untrusted-data marker in
 * the text, so that is stripped before parsing. Asserting the marker is present
 * is the job of the dedicated tests in the suite.
 */
export function resultJson(result: CallToolResult): unknown {
  const text = resultText(result);
  const start = text.indexOf('\n\n');
  const fromText: unknown = JSON.parse(
    start === -1 ? text : text.slice(start + 2)
  );
  if (result.structuredContent === undefined) {
    throw new Error(
      'the result carried no structuredContent — every tool here declares an ' +
        `outputSchema, so this one answered wrongly.\nText was: ${text.slice(0, 300)}`
    );
  }
  expect(result.structuredContent, 'structuredContent vs. text').toEqual(
    fromText
  );
  return result.structuredContent;
}

/** The confirmation token a guarded tool handed back on its first call. */
export function tokenOf(result: CallToolResult): string {
  const match = /confirm_token="([0-9a-f]+)"/.exec(resultText(result));
  if (match?.[1] === undefined) {
    throw new Error(
      `no confirm_token in the result — did the client declare elicitation? ` +
        `Got: ${resultText(result).slice(0, 300)}`
    );
  }
  return match[1];
}

/**
 * Runs a guarded tool through both halves of its two-call token.
 *
 * Takes the client rather than living on what `connect` returns, so the
 * signature matches every other repository in this family. Only meaningful on
 * a client that declared no elicitation: with a dialog available the server
 * asks instead of offering a token, which is the point of the dialog.
 */
export async function confirmed(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<CallToolResult> {
  const first = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  return client.callTool({
    name,
    arguments: { ...args, confirm_token: tokenOf(first) },
  }) as Promise<CallToolResult>;
}
