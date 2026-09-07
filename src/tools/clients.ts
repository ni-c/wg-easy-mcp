import type { McpServer } from '@modelcontextprotocol/server';
import {
  orderedResourceKey,
  setResourceKey,
  type Approver,
  type ConfirmationStore,
} from 'mcp-approval';
import { z } from 'zod';
import { redactSecrets } from '../redact.js';
import { errorResult, jsonResult, run, upstreamResult } from '../result.js';

import type { WgEasyApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import {
  cleanRecord,
  hasControlCharacters,
  objectOf,
  shapeClient,
  shapeClientList,
  stringBody,
  stringOf,
} from '../boundary.js';
import {
  clientRecord,
  markedClient,
  truncationNote,
  untrustedFields,
} from '../output-schema.js';

/**
 * The largest client id this server will address.
 *
 * Fifteen digits, which is a safe integer by construction — the point is that
 * no arithmetic happens between the check and the request path. wg-easy hands
 * out ids from an auto-incrementing column, so this is not a limit anybody
 * reaches; it is a limit on what the *string* branch below can turn into.
 */
const MAX_CLIENT_ID = 999_999_999_999_999;

/**
 * A client id, as a number or as the decimal string a client may send instead.
 *
 * Spelled out rather than left to `z.coerce.number()`, which is `Number()` and
 * therefore accepts far more than a number: `Number(true)` is `1` and
 * `Number(['3'])` is `3`, so `{clientId: true}` used to address the first
 * client on the instance. Nothing legitimate sends those, and on a VPN a
 * silently reinterpreted target is the wrong kind of forgiving.
 *
 * The digit run is bounded in the *pattern*, not after `Number()`. `/^\d+$/`
 * looks like validation and is not one: four hundred nines are digits, and
 * `Number` of them is `Infinity`, which passed a `> 0` check and went out as
 * `GET /api/client/Infinity`. Seventeen digits are worse — they become a
 * different, plausible number on the way to the path, so the request is a
 * well-formed one against the wrong client.
 */
const clientIdSchema = z
  .union([
    z.number().int().positive().max(MAX_CLIENT_ID),
    z
      .string()
      .regex(/^[0-9]{1,15}$/)
      .transform(Number)
      .refine((value) => value > 0),
  ])
  .describe('Numeric ID of the client (see list_clients)');

/**
 * Ceilings for what a caller may send.
 *
 * Every one of these is spliced into a request — a query string, a JSON body —
 * and none of them had a length. They are set from what the field *is* rather
 * than from a round number: a WireGuard MTU has a real range, a keepalive is a
 * 16-bit interval, an address is an address, and a name is a label a person
 * reads in a list.
 */
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 64;
const MAX_LIST_ENTRIES = 64;

/** The note the two file tools attach when the file carries control bytes. */
const fileWarning = z
  .string()
  .optional()
  .describe(
    'Present when the file contains control characters. It is passed through ' +
      'unchanged regardless — it has to work as a configuration.'
  );

const confirmToken = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{32}$/)
  .optional()
  .describe('The token from this tool’s previous, unconfirmed response.');

/**
 * Fields of the wg-easy `ClientUpdateSchema`. The update endpoint expects the
 * complete object, so `update_client` merges partial input into the current
 * client state before posting.
 */
const UPDATABLE_FIELDS = [
  'name',
  'enabled',
  'expiresAt',
  'ipv4Address',
  'ipv6Address',
  'preUp',
  'postUp',
  'preDown',
  'postDown',
  'allowedIps',
  'serverAllowedIps',
  'firewallIps',
  'mtu',
  'jC',
  'jMin',
  'jMax',
  'i1',
  'i2',
  'i3',
  'i4',
  'i5',
  'persistentKeepalive',
  'serverEndpoint',
  'dns',
] as const;

/** The display name of a client, for the caller-supplied lines of a prompt. */
async function clientName(api: WgEasyApi, id: number): Promise<string> {
  // Also the existence check: a missing client fails here with the API's own
  // error, before anybody is asked to approve something that cannot happen.
  //
  // What comes back is read through the boundary, not off a cast. A body of
  // `null` — legal JSON, and what a proxy in front of the instance answers on a
  // route it does not know — used to throw "Cannot read properties of null"
  // from inside the dialog's own arguments, so the tool failed with a
  // JavaScript error rather than with a sentence, before anybody was asked
  // anything.
  const client = cleanRecord(await api.get(`/api/client/${id}`));
  return stringOf(client.name) ?? `#${id}`;
}

/**
 * A file answer — a `.conf` or a QR-code SVG — with a note when it carries
 * control characters.
 *
 * The file itself is passed through **byte for byte**: it has to round-trip
 * into a WireGuard client, and a configuration that has been quietly edited on
 * the way is worse than one that is refused. So the control characters are
 * named rather than removed, which is the opposite of what happens to a client
 * name, and for the opposite reason.
 */
function fileResult(text: string): Record<string, unknown> {
  return hasControlCharacters(text)
    ? {
        warning:
          'This file contains control characters. It is passed through ' +
          'unchanged because it has to work as a configuration, but do not ' +
          'render it into a terminal without escaping it.',
      }
    : {};
}

export function registerClientTools(
  server: McpServer,
  api: WgEasyApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'list_clients',
    {
      title: 'List WireGuard clients',
      description:
        'List all WireGuard clients of the wg-easy instance, including their status (enabled/expired), addresses and traffic statistics.',
      inputSchema: z.object({
        filter: z
          .string()
          .max(MAX_NAME_LENGTH)
          .optional()
          .describe('Optional name filter (substring match)'),
        sort: z
          .enum(['asc', 'desc'])
          .optional()
          .describe('Sort by name, ascending or descending'),
      }),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        truncated: truncationNote,
        count: z.number().int().describe('Clients in this answer.'),
        skipped: z
          .number()
          .int()
          .optional()
          .describe(
            'Entries the instance sent that were not client records. Present ' +
              'only when there were any.'
          ),
        clients: z.array(clientRecord),
      }),
    },
    ({ filter, sort }) =>
      run(async () => {
        const query = new URLSearchParams();
        if (filter) query.set('filter', filter);
        if (sort) query.set('sort', sort);
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        // Wrapped in an object rather than answered as the bare array wg-easy
        // sends. An output schema with a non-object root is rewritten to
        // `{result: …}` for a 2025-era client, so the tool would answer in two
        // different shapes depending on who asked. `count` comes with the
        // wrapper, and is what a truncated answer is read against.
        const answer = redactSecrets(await api.get(`/api/client${suffix}`));
        // Shaped, not cast. One `id` spelled as a string, a `1e999` in
        // `transferRx` or a numeric `name` in a single row used to answer the
        // *whole* listing with `Output validation error` and no cause — every
        // good record lost because of one bad one.
        const { clients, skipped } = shapeClientList(answer);
        return upstreamResult(
          {
            count: clients.length,
            ...(skipped > 0 ? { skipped } : {}),
            clients,
          },
          'Narrow the result with the filter argument, or fetch a single client with get_client.'
        );
      })
  );

  server.registerTool(
    'get_client',
    {
      title: 'Get WireGuard client',
      description:
        'Get the full details of a single WireGuard client.\n\n' +
        'The private key and pre-shared key are redacted. They are not missing ' +
        'from the instance — wg-easy returns them here in full, and this ' +
        'server removes them, because a key in the conversation is a key in ' +
        'the transcript. Use get_client_config or get_client_qrcode when the ' +
        'key is genuinely wanted: handing a peer its configuration is what ' +
        'those two are for.',
      inputSchema: z.object({ clientId: clientIdSchema }),
      annotations: READ_ONLY,
      outputSchema: markedClient,
    },
    ({ clientId }) =>
      run(async () =>
        upstreamResult(
          shapeClient(redactSecrets(await api.get(`/api/client/${clientId}`))),
          'Fetch the configuration file separately with get_client_config.'
        )
      )
  );

  server.registerTool(
    'create_client',
    {
      title: 'Create WireGuard client',
      description:
        'Create a new WireGuard client. Keys and IP addresses are generated by wg-easy. Returns the new client ID. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(MAX_NAME_LENGTH)
          .describe('Display name of the new client'),
        expiresAt: z
          .string()
          .max(MAX_ADDRESS_LENGTH)
          .optional()
          .describe(
            'Optional expiry date as ISO string (e.g. 2026-12-31). Omit for no expiry.'
          ),
        confirm_token: confirmToken,
      }),
      annotations: {
        // Additive: it grants a new VPN identity and takes nothing away. Not
        // idempotent — wg-easy keys clients by an id it generates, so calling
        // twice leaves two clients with two key pairs.
        //
        // Guarded all the same, and not for the reason destructiveHint carries:
        // this issues a credential that reaches the network behind the VPN. The
        // annotation says what a call destroys; the dialog decides what a call
        // is allowed to grant.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: markedClient,
    },
    async ({ name, expiresAt, confirm_token }, mcp) =>
      run(async () => {
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: 'create a new WireGuard client',
            consequence:
              'It receives its own key pair and can connect to every ' +
              'network this VPN reaches. Deleting it later does not undo a ' +
              'connection it made in the meantime.',
            // A (name, expiry) tuple, not a set: a client name is free text,
            // so a name that spells a date paired with an expiry that spells
            // the name would sort to the same set as the other way round, and
            // one token would confirm both. `orderedResourceKey` binds each
            // part to its place.
            resourceKey: orderedResourceKey('create_client', [
              name,
              expiresAt ?? '',
            ]),
            token: confirm_token,
            details: [
              { label: 'Name', value: name },
              { label: 'Expires', value: expiresAt ?? 'never' },
            ],
            toolName: 'create_client',
            title: 'Create this VPN client?',
            hint: 'Tick to create it, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. create_client did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;

        return upstreamResult(
          shapeClient(
            redactSecrets(
              await api.post('/api/client', {
                name,
                expiresAt: expiresAt ?? null,
              })
            )
          ),
          'Re-read the new client with get_client.'
        );
      })
  );

  server.registerTool(
    'update_client',
    {
      title: 'Update WireGuard client',
      description:
        'Update a WireGuard client. Only the provided fields are changed; all other settings are preserved. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        clientId: clientIdSchema,
        confirm_token: confirmToken,
        name: z
          .string()
          .min(1)
          .max(MAX_NAME_LENGTH)
          .optional()
          .describe('New display name'),
        enabled: z
          .boolean()
          .optional()
          .describe('Enable or disable the client'),
        expiresAt: z
          .string()
          .max(MAX_ADDRESS_LENGTH)
          .describe('Expiry date as ISO string, or null to remove the expiry')
          .nullable()
          .optional(),
        ipv4Address: z
          .string()
          .max(MAX_ADDRESS_LENGTH)
          .optional()
          .describe('IPv4 address of the client'),
        ipv6Address: z
          .string()
          .max(MAX_ADDRESS_LENGTH)
          .optional()
          .describe('IPv6 address of the client'),
        allowedIps: z
          .array(z.string().max(MAX_ADDRESS_LENGTH))
          .max(MAX_LIST_ENTRIES)
          .nullable()
          .optional()
          .describe(
            'CIDRs routed through the tunnel on the client side, or null to use the server default'
          ),
        serverAllowedIps: z
          .array(z.string().max(MAX_ADDRESS_LENGTH))
          .max(MAX_LIST_ENTRIES)
          .optional()
          .describe('Additional CIDRs the server routes to this client'),
        dns: z
          .array(z.string().max(MAX_ADDRESS_LENGTH))
          .max(MAX_LIST_ENTRIES)
          .nullable()
          .optional()
          .describe(
            'DNS servers for the client, or null to use the server default'
          ),
        // The real range of a WireGuard MTU: below 1280 an IPv6 tunnel cannot
        // carry a minimum-sized packet, and 9000 is a jumbo frame. An unbounded
        // integer here is an unbounded number in the request body, and a
        // plausible-looking one is a tunnel that silently stops passing traffic.
        mtu: z
          .number()
          .int()
          .min(1280)
          .max(9000)
          .optional()
          .describe('MTU for the client (1280–9000)'),
        persistentKeepalive: z
          .number()
          .int()
          .min(0)
          .max(65535)
          .optional()
          .describe('Persistent keepalive interval in seconds (0 = off)'),
      }),
      annotations: {
        // Destructive: the fields it is given replace what was there, and an
        // address or allowed-IP range that is overwritten is not recoverable
        // from here. Only the provided fields change, so sending the same call
        // twice lands on the same client.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: markedClient,
    },
    async ({ clientId, confirm_token, ...changes }, mcp) =>
      run(async () => {
        // Bound to the exact edit, not merely to the client: approving a name
        // change must not license a later call that moves the address or
        // widens serverAllowedIps. This is a genuine set, so `setResourceKey`
        // (sort, then fingerprint) is the right key and stays: every part is a
        // self-labelled `field=value` pair, the order the fields arrived in
        // carries no meaning, and the numeric id cannot be mistaken for one
        // of them.
        const edit = Object.entries(changes)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `change WireGuard client ${clientId}`,
            consequence:
              'The fields listed below replace what is there now. An address ' +
              'or an allowed-IP range that is overwritten cannot be read back ' +
              'from here.',
            resourceKey: setResourceKey('update_client', [
              String(clientId),
              ...edit,
            ]),
            token: confirm_token,
            details: [
              { label: 'Client', value: await clientName(api, clientId) },
              { label: 'Changes', value: edit.join(', ') || '(none)' },
            ],
            toolName: 'update_client',
            title: `Change client ${clientId}?`,
            hint: 'Tick to apply the change, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. update_client did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;

        // The API expects the complete update object, so merge the partial
        // input into the current client state.
        //
        // `cleanRecord`, not a cast: a body that is not an object — `null`, a
        // string from a proxy, an array — made `current[field]` either throw or
        // read characters off a string into the update. An empty record merges
        // to a body of nulls plus the caller's fields, which is the honest
        // answer when the instance did not describe the client it has.
        const current = cleanRecord(await api.get(`/api/client/${clientId}`));
        const body: Record<string, unknown> = {};
        for (const field of UPDATABLE_FIELDS) {
          body[field] = current[field] ?? null;
        }
        for (const [key, value] of Object.entries(changes)) {
          if (value !== undefined) body[key] = value;
        }
        return upstreamResult(
          shapeClient(
            redactSecrets(await api.post(`/api/client/${clientId}`, body))
          ),
          'Re-read the client with get_client.'
        );
      })
  );

  server.registerTool(
    'enable_client',
    {
      title: 'Enable WireGuard client',
      description:
        'Enable a WireGuard client so it can connect again. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        clientId: clientIdSchema,
        confirm_token: confirmToken,
      }),
      annotations: {
        // Restores access rather than removing it, so nothing here is
        // destructive.
        //
        // Guarded all the same, for `create_client`'s reason rather than
        // `delete_client`'s: this re-arms a credential that is already
        // installed on a peer and reaches every network behind the VPN. If
        // `disable_client` is the reversible revocation this server recommends
        // — and its own catalogue says it is — then enabling is the undo of a
        // revocation, and the undo cannot be the cheaper call. Leaving it
        // ungated also made the guard on `update_client({enabled: true})`
        // avoidable by picking the other tool for the same state change.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: markedClient,
    },
    async ({ clientId, confirm_token }, mcp) =>
      run(async () => {
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `enable WireGuard client ${clientId}`,
            consequence:
              'This client’s existing key pair can reach every network this ' +
              'VPN reaches again. The configuration is already installed on ' +
              'the peer, so nothing further has to be handed over for it to ' +
              'connect.',
            resourceKey: setResourceKey('enable_client', [String(clientId)]),
            token: confirm_token,
            details: [
              { label: 'Client', value: await clientName(api, clientId) },
            ],
            toolName: 'enable_client',
            title: `Enable client ${clientId}?`,
            hint: 'Tick to enable it, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. enable_client did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;

        return upstreamResult(
          shapeClient(
            redactSecrets(await api.post(`/api/client/${clientId}/enable`))
          ),
          'Re-read the client with get_client.'
        );
      })
  );

  server.registerTool(
    'disable_client',
    {
      title: 'Disable WireGuard client',
      description:
        'Disable a WireGuard client. The client keeps its configuration but can no longer connect.',
      inputSchema: z.object({ clientId: clientIdSchema }),
      annotations: {
        // Not destructive: the client and its keys stay, only the tunnel stops.
        // enable_client puts it back.
        //
        // Ungated on purpose, and the asymmetry with enable_client is the
        // point: this one only ever withdraws access. Making the safe half of
        // a revoke/restore pair ask a person would put a dialog between an
        // operator and cutting off a peer they have just decided to cut off.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: markedClient,
    },
    ({ clientId }) =>
      run(async () =>
        upstreamResult(
          shapeClient(
            redactSecrets(await api.post(`/api/client/${clientId}/disable`))
          ),
          'Re-read the client with get_client.'
        )
      )
  );

  server.registerTool(
    'delete_client',
    {
      title: 'Delete WireGuard client',
      description:
        'Permanently delete a WireGuard client. This is irreversible: the client loses VPN access and its keys cannot be restored. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        clientId: clientIdSchema,
        confirm_token: confirmToken,
      }),
      annotations: {
        // Idempotent by the specification's wording — "no additional effect on
        // its environment". The second call fails, but the world is the same
        // either way, which is what lets a client retry after a timeout.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z.object({
        deleted: z.number().int().describe('The id that no longer exists.'),
      }),
    },
    async ({ clientId, confirm_token }, mcp) =>
      run(async () => {
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete WireGuard client ${clientId}`,
            consequence:
              'Its key pair is destroyed and cannot be restored. Anyone using ' +
              'that configuration loses VPN access, and re-creating the client ' +
              'gives them a different key they have to install.',
            resourceKey: setResourceKey('delete_client', [String(clientId)]),
            token: confirm_token,
            details: [
              { label: 'Client', value: await clientName(api, clientId) },
            ],
            toolName: 'delete_client',
            title: `Delete client ${clientId}?`,
            hint: 'Tick to delete it, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. delete_client did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;

        await api.delete(`/api/client/${clientId}`);
        return jsonResult({ deleted: clientId });
      })
  );

  server.registerTool(
    'get_client_config',
    {
      title: 'Get WireGuard client configuration',
      description:
        'Get the WireGuard configuration file (wg .conf format) for a client. SENSITIVE: the output contains the client private key — treat it as a secret and do not repeat it unnecessarily.',
      inputSchema: z.object({ clientId: clientIdSchema }),
      annotations: READ_ONLY,
      // The file goes in a field rather than being the result. A scalar root is
      // rewritten to `{result: …}` for a 2025-era client, so the answer would
      // have two shapes; and a `.conf` is exactly the payload a reader has to
      // be able to find by name rather than by position.
      outputSchema: z.object({
        ...untrustedFields,
        // `truncated` is declared because the budget can add it, and a
        // `z.object` emits `additionalProperties: false`: a field the helper
        // attaches and the schema does not name is refused by every client that
        // has loaded `tools/list`, on the success path only.
        truncated: truncationNote,
        warning: fileWarning,
        configuration: z
          .string()
          .describe('The wg .conf file. Contains the client private key.'),
      }),
    },
    ({ clientId }) =>
      run(async () => {
        const configuration = stringBody(
          await api.get(`/api/client/${clientId}/configuration`),
          'a WireGuard configuration file'
        );
        return upstreamResult(
          { configuration, ...fileResult(configuration) },
          'Download the configuration from the wg-easy UI if it was cut off.'
        );
      })
  );

  server.registerTool(
    'get_client_qrcode',
    {
      title: 'Get WireGuard client QR code',
      description:
        'Get the client configuration as a QR code (SVG markup) for scanning with the WireGuard mobile app. SENSITIVE: the QR code encodes the client private key — treat it as a secret.',
      inputSchema: z.object({ clientId: clientIdSchema }),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        // A QR-code SVG is routinely tens of kilobytes, so this is the tool the
        // budget shortens most often — and the one whose closed schema then
        // refused its own answer.
        truncated: truncationNote,
        warning: fileWarning,
        svg: z.string().describe('SVG markup. Encodes the client private key.'),
      }),
    },
    ({ clientId }) =>
      run(async () => {
        const svg = stringBody(
          await api.get(`/api/client/${clientId}/qrcode.svg`),
          'QR-code SVG markup'
        );
        return upstreamResult(
          { svg, ...fileResult(svg) },
          'Use get_client_config instead if the QR code markup was cut off.'
        );
      })
  );

  server.registerTool(
    'generate_one_time_link',
    {
      title: 'Generate one-time config link',
      description:
        'Generate a one-time download link for a client configuration that can ' +
        'be shared with the end user. SENSITIVE: anyone with the link can ' +
        'download the full client configuration without authentication — share ' +
        'it only with the intended user. The link expires after five minutes. ' +
        'Asks a person first; where the client cannot show a dialog, call once ' +
        'to receive a token and again with it.\n\n' +
        'If the answer says the link value could not be read back, the link ' +
        'still exists on the instance and is downloadable by anyone who has ' +
        'the URL. Say so rather than reporting that nothing happened, and ' +
        'point at the wg-easy UI, where it can be revoked.',
      inputSchema: z.object({
        clientId: clientIdSchema,
        confirm_token: confirmToken,
      }),
      annotations: {
        // Destroys nothing, and that is the whole difficulty with this one: it
        // mints a URL that hands the full client configuration — private key
        // included — to anyone who has it, without authentication.
        // destructiveHint is the wrong axis for that risk, which is why the
        // tool is guarded instead. Not idempotent: each call issues a fresh
        // link, and the previous one stops working.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      // One shape for all three outcomes, and `created` is the field that
      // matters in every one of them. The link exists on the instance as soon
      // as the POST returns; whether its value could be read back afterwards is
      // a second question, and answering the two in two different shapes is how
      // a reader ends up believing nothing happened.
      outputSchema: z.object({
        ...untrustedFields,
        created: z
          .literal(true)
          .describe('The link exists on the instance, whatever else is here.'),
        oneTimeLink: z.string().optional().describe('The token, if read back.'),
        path: z.string().optional().describe('Where the token is downloaded.'),
        expiresAt: z
          .string()
          .describe('ISO 8601, or null when the link does not expire.')
          .nullable()
          .optional(),
        warning: z
          .string()
          .optional()
          .describe(
            'Present when the value could not be read back. The link is live ' +
              'regardless and can be revoked in the wg-easy UI.'
          ),
      }),
    },
    async ({ clientId, confirm_token }, mcp) =>
      run(async () => {
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `issue a one-time download link for client ${clientId}`,
            consequence:
              'Anyone who has the URL can download that client’s full ' +
              'configuration, private key included, without logging in. The ' +
              'link cannot be withdrawn once it has been passed on.',
            resourceKey: setResourceKey('generate_one_time_link', [
              String(clientId),
            ]),
            token: confirm_token,
            details: [
              { label: 'Client', value: await clientName(api, clientId) },
            ],
            toolName: 'generate_one_time_link',
            title: `Issue a download link for client ${clientId}?`,
            hint: 'Tick to issue the link, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(
            'The user declined. generate_one_time_link did nothing.'
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        await api.post(`/api/client/${clientId}/generateOneTimeLink`);

        // Past this point the link exists on the instance, whatever happens
        // below. The read-back is a second request and can fail on its own —
        // and if that failure were allowed to reach `run()`, the answer would
        // be a bare transport error saying only that a GET failed. A model
        // reads that as "no link was made" while an unauthenticated URL
        // serving the full configuration, private key included, is live for
        // the next five minutes. Report the mint first, then the failure.
        let clients: unknown;
        try {
          // The **list**, not `/api/client/{id}`. wg-easy joins the one-time
          // link onto the client row in `findMany` and not in `findById`, so
          // the single-client read answers `oneTimeLink: null` for a client
          // that has a live link — verified against 15.4.0. Reading the single
          // client here is what made this tool report "the link value was not
          // returned by the API" on every successful call, and what the tool's
          // own description used to explain as wg-easy answering HTTP 500. It
          // does not: the POST answers 200 and the link works.
          clients = await api.get('/api/client');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return upstreamResult(
            {
              created: true,
              warning:
                `The one-time link for client ${clientId} was created, but ` +
                `reading it back failed: ${message}. The link exists on the ` +
                'instance even though its value is not available here. Check ' +
                'the wg-easy UI and revoke the link if it was not intended.',
            },
            'Read the client list with list_clients.'
          );
        }
        const found = shapeClientList(clients).clients.find(
          (entry) => entry.id === clientId
        );
        // Accepts both shapes: 15.4.0 nests the value in a joined row, older
        // builds put the string on the client directly. Either way the value
        // has to *be* a string — the schema below types `oneTimeLink` and
        // `expiresAt`, and a number where the token belongs used to leave as a
        // number and fail the whole answer. A token that is not a string is a
        // token this server cannot hand on, which is the `warning` case: the
        // link is live on the instance regardless.
        const record = found?.oneTimeLink;
        const link =
          typeof record === 'string'
            ? record
            : stringOf(objectOf(record).oneTimeLink);
        const expiresAt =
          typeof record === 'string'
            ? null
            : (stringOf(objectOf(record).expiresAt) ?? null);
        if (link === undefined || link === '') {
          return upstreamResult(
            {
              created: true,
              warning:
                `The one-time link for client ${clientId} was created, but ` +
                'its value was not in the client list. The link exists on the ' +
                'instance and can be downloaded by anyone who has the URL. ' +
                'Check the wg-easy UI and revoke it if it was not intended.',
            },
            'Read the client list with list_clients.'
          );
        }
        return upstreamResult(
          {
            created: true,
            oneTimeLink: link,
            path: `/cnf/${link}`,
            expiresAt,
          },
          'Re-read the client with get_client.'
        );
      })
  );
}
