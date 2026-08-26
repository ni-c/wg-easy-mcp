/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* anything is registered — and in read-only mode the write tools are
 * never registered at all. Deriving the catalogue from what actually reached
 * `registerTool` would make `WG_EASY_ALLOW_TOOLS=create_client` report
 * "unknown tool" under `WG_EASY_READ_ONLY=true`, which is the one answer that
 * is wrong.
 *
 * This is also the full tool surface, hard-coded on purpose: a tool that appears
 * or disappears by accident is a change to the server's contract and has to be a
 * deliberate edit here. `test/tool-filter.test.ts` asserts that these lists and
 * the tools the server really registers are the same set.
 */

/** Registered always. Every one carries `readOnlyHint: true`. */
export const READ_TOOLS = [
  'get_client',
  'get_client_config',
  'get_client_qrcode',
  'get_server_info',
  'list_clients',
] as const;

/** Registered unless `WG_EASY_READ_ONLY` is set. */
export const WRITE_TOOLS = [
  'create_client',
  'delete_client',
  'disable_client',
  'enable_client',
  'generate_one_time_link',
  'update_client',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * What `WG_EASY_ALLOW_TOOLS=essential` selects: onboard a peer, revoke it safely.
 *
 * 8 of 11. Left out on purpose: `delete_client`, deliberately: disabling revokes access reversibly, and on
 * a VPN the irreversible variant should have to be named explicitly.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'get_server_info',
  'list_clients',
  'get_client',
  'create_client',
  'get_client_config',
  'get_client_qrcode',
  'enable_client',
  'disable_client',
];
