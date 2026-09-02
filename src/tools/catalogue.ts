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

/**
 * Registered always. Every one carries `readOnlyHint: true` *and* discloses no
 * key material — those two are not the same property, which is why
 * {@link KEY_TOOLS} is a separate list.
 */
export const READ_TOOLS = [
  'get_client',
  'get_server_info',
  'list_clients',
] as const;

/**
 * Reads that hand out a client's **private key** in the clear:
 * `get_client_config` returns the whole `wg` configuration file,
 * `get_client_qrcode` the same thing encoded as an SVG.
 *
 * They are reads, and their `readOnlyHint: true` is honest — nothing on the
 * instance changes. But `WG_EASY_READ_ONLY` is the one coarse switch an
 * operator has for putting this server in front of a less trusted session, and
 * a mode that leaves key disclosure untouched is not the mode its name
 * promises: `list_clients` followed by `get_client_config` yields as many
 * ready-to-use VPN configurations as there are peers.
 *
 * So they are suppressed with the write tools, and left out of
 * {@link ESSENTIAL_TOOLS}. This is the rule `delete_client` is already held to,
 * applied to disclosure instead of destruction: the variant that cannot be
 * taken back has to be named explicitly —
 * `WG_EASY_ALLOW_TOOLS=essential,get_client_config`.
 */
export const KEY_TOOLS = ['get_client_config', 'get_client_qrcode'] as const;

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
export const ALL_TOOLS: readonly string[] = [
  ...READ_TOOLS,
  ...KEY_TOOLS,
  ...WRITE_TOOLS,
];

/**
 * What `WG_EASY_ALLOW_TOOLS=essential` selects: see the estate, onboard a peer,
 * revoke it reversibly.
 *
 * 6 of 11. Left out on purpose:
 *
 * - `delete_client`: disabling revokes access reversibly, and on a VPN the
 *   irreversible variant should have to be named explicitly.
 * - `update_client`: it can move an address or widen `serverAllowedIps`, which
 *   is a routing change rather than an onboarding step.
 * - `generate_one_time_link`, `get_client_config`, `get_client_qrcode`: all
 *   three hand a peer's private key to whoever receives the answer. Handing out
 *   a configuration is a normal part of onboarding, so this preset does make
 *   that one call harder — deliberately. Add the tool by name where the same
 *   session should also deliver the config.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'get_server_info',
  'list_clients',
  'get_client',
  'create_client',
  'enable_client',
  'disable_client',
];
