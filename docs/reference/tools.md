# Tools

All eleven are registered unless you say otherwise. `WG_EASY_ALLOW_TOOLS` and
`WG_EASY_DENY_TOOLS` narrow the list to the ones you want, and `essential` selects a
curated six — see
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Eleven tools, all against the wg-easy v15 REST API. Every payload that comes back
from wg-easy carries the untrusted-data marker and the 60 000-character budget
described in [Security](/guide/security).

Every tool declares an `outputSchema` and answers with `structuredContent` beside
the text block, so a client can use the result without parsing prose. The marker
travels with it as `untrusted: true` and `source: "wg-easy"` fields — a client
that reads the structured half and ignores the text would otherwise get free-form
client names and endpoints with no framing at all. Only `delete_client` is
without it: it reports an id this server was given, not anything the instance
sent back.

Three answers are wrapped in an object rather than being one: `list_clients`
gives `{count, clients}`, `get_client_config` gives `{configuration}` and
`get_client_qrcode` gives `{svg}`. A schema whose root is not an object is served
to a 2025-era client rewritten as `{result: …}`, so those three would otherwise
answer in two different shapes depending on who asked.

An oversized answer is shortened as an object — longest text field first, then
list entries — and a `truncated` field says what was cut. What wg-easy sends is
described with every field optional and unknown fields allowed; the SDK validates
each result against its schema before it goes out, so a stricter shape would turn
a wg-easy release that adds a field into a tool that fails outright.

| Tool                     | Annotation        | Summary                                     |
| ------------------------ | ----------------- | ------------------------------------------- |
| `list_clients`           | `readOnlyHint`    | All clients, optionally filtered and sorted |
| `get_client`             | `readOnlyHint`    | One client in full                          |
| `create_client`          | —                 | Create a client                             |
| `update_client`          | —                 | Change selected fields of a client          |
| `enable_client`          | `idempotentHint`  | Let a client connect again — two-step       |
| `disable_client`         | `idempotentHint`  | Block a client, keeping its config          |
| `delete_client`          | `destructiveHint` | Delete a client — two-step                  |
| `get_client_config`      | `readOnlyHint`    | The client's `.conf` file — hands out a key |
| `get_client_qrcode`      | `readOnlyHint`    | The client config as an SVG QR code         |
| `generate_one_time_link` | —                 | A shareable one-time config download link   |
| `get_server_info`        | `readOnlyHint`    | Release, settings and interface config      |

## list_clients

Lists all WireGuard clients with status, addresses and traffic statistics.

| Argument | Type                | Required | Description                 |
| -------- | ------------------- | -------- | --------------------------- |
| `filter` | string              | no       | Substring match on the name |
| `sort`   | `'asc'` \| `'desc'` | no       | Sort by name                |

## get_client

Full details of a single client.

| Argument   | Type             | Required | Description                    |
| ---------- | ---------------- | -------- | ------------------------------ |
| `clientId` | positive integer | yes      | Numeric ID from `list_clients` |

## create_client

Creates a client. wg-easy generates the keys and IP addresses; the new client ID
comes back in the response.

| Argument    | Type   | Required | Description                                     |
| ----------- | ------ | -------- | ----------------------------------------------- |
| `name`      | string | yes      | Display name                                    |
| `expiresAt` | string | no       | ISO date, e.g. `2026-12-31`. Omit for no expiry |

## update_client

Changes only the fields you pass; everything else keeps its current value.

::: info Why it reads before it writes
wg-easy's update endpoint expects the **complete** client object, so this tool
fetches the current state and merges your changes into it. Fields outside the
schema below — including the `preUp`/`postUp`/`preDown`/`postDown` shell hooks,
which run as root on the wg-easy host — are dropped and can never be set here.
:::

| Argument              | Type             | Description                                     |
| --------------------- | ---------------- | ----------------------------------------------- |
| `clientId`            | positive integer | **Required.** Which client                      |
| `name`                | string           | New display name                                |
| `enabled`             | boolean          | Enable or disable                               |
| `expiresAt`           | string \| null   | ISO date, or `null` to remove the expiry        |
| `ipv4Address`         | string           | Client IPv4 address                             |
| `ipv6Address`         | string           | Client IPv6 address                             |
| `allowedIps`          | string[] \| null | CIDRs routed through the tunnel client-side     |
| `serverAllowedIps`    | string[]         | Extra CIDRs the server routes to this client    |
| `dns`                 | string[] \| null | DNS servers, or `null` for the server default   |
| `mtu`                 | integer          | MTU                                             |
| `persistentKeepalive` | integer          | Keepalive interval in seconds (`0` disables it) |

## enable_client / disable_client

A disabled client keeps its configuration and keys but cannot connect, which
makes `disable_client` the reversible alternative to deleting. It takes only
`clientId` and asks nobody: it can only ever withdraw access.

`enable_client` is the undo of that revocation, so since 0.5.0 it asks a person
first and takes `confirm_token` on the fallback path, exactly like
`delete_client` below. The key pair it re-arms is already installed on the peer,
so nothing further has to be handed over for that peer to reach every network
behind the VPN.

| Argument        | Type             | Required | Description                                |
| --------------- | ---------------- | -------- | ------------------------------------------ |
| `clientId`      | positive integer | yes      | Which client                               |
| `confirm_token` | string           | no       | `enable_client` only, on the fallback path |

::: warning enable_client was ungated before 0.5.0
`update_client({clientId, enabled: true})` has always asked. `enable_client` did
not, so the same state change was guarded or not depending on which of the two
tools was called — and under `WG_EASY_ALLOW_TOOLS=essential` only the ungated
one was registered.
:::

## delete_client

Permanently deletes a client. **Irreversible** — the peer loses access and its
keys cannot be restored.

| Argument        | Type             | Required | Description                                                      |
| --------------- | ---------------- | -------- | ---------------------------------------------------------------- |
| `clientId`      | positive integer | yes      | Which client                                                     |
| `confirm_token` | string           | no       | Only on the fallback path — see [Approval](../guide/approval.md) |

Where the MCP client supports elicitation, this raises a **dialog a person has
to tick**, showing the client's name; the model cannot answer it on their
behalf. Where it does not, the tool falls back to a two-call token: the first
call returns a random token valid **5 minutes** and bound to that client ID,
the second has to quote it back, and the token is consumed on use.

A token issued for one client ID will not delete another, and an expired token
simply starts the flow over.

::: warning The parameter was renamed in 0.5.0
It used to be `confirmToken`. The whole family spells it `confirm_token`, and a
prompt that tells a model which argument to send has to name the one the schema
declares.
:::

## get_client_config

Returns the WireGuard `.conf` file for a client.

::: danger Contains the private key
The configuration includes the client's private key in plain text. It is not
redacted — handing a peer its config is the purpose of this tool — so treat the
output as a credential.
:::

## get_client_qrcode

The same configuration as SVG QR code markup, for the WireGuard mobile apps. It
encodes the same private key and deserves the same handling.

## generate_one_time_link

Generates a link that lets someone download a client configuration **once,
without authenticating**, so it can be sent to the end user. The link expires
after five minutes.

Returns the link value, its path (`/cnf/<link>`) and `expiresAt`. Anyone who has
the URL before the intended recipient does gets the config, so share it over a
channel you trust.

::: warning A failed read-back does not mean no link was made
The tool mints the link and then reads it back. If the read-back fails, the
answer says the link **was created** and points at the wg-easy UI, where it can
be revoked. Before 0.5.0 the read-back used `GET /api/client/{id}`, which does
not carry the link — wg-easy joins it onto the client row in the list query only
— so every successful call reported "the link value was not returned by the
API" while a working, unauthenticated download URL was live.
:::

The link token is redacted from `list_clients` and `get_client`, which would
otherwise hand it out as a bearer credential; `expiresAt` is not, so a listing
still shows that a link is live.

## get_server_info

Aggregates three admin endpoints — release/update status, general settings and
the WireGuard interface configuration. Secret fields are
[redacted](/guide/security#admin-secrets-are-redacted).

Takes no arguments. Each section is fetched independently, so one failing
endpoint returns an `error` for that section instead of failing the whole call —
`/api/information` in particular returns `HTTP 500` when the wg-easy container
cannot reach GitHub.
