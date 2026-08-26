# Tools

All eleven are registered unless you say otherwise. `WG_EASY_ALLOW_TOOLS` and
`WG_EASY_DENY_TOOLS` narrow the list to the ones you want, and `essential` selects a
curated eight — see
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Eleven tools, all against the wg-easy v15 REST API. Every payload that comes back
from wg-easy carries the untrusted-data marker and the 60 000-character budget
described in [Security](/guide/security).

| Tool                     | Annotation        | Summary                                     |
| ------------------------ | ----------------- | ------------------------------------------- |
| `list_clients`           | `readOnlyHint`    | All clients, optionally filtered and sorted |
| `get_client`             | `readOnlyHint`    | One client in full                          |
| `create_client`          | —                 | Create a client                             |
| `update_client`          | —                 | Change selected fields of a client          |
| `enable_client`          | `idempotentHint`  | Let a client connect again                  |
| `disable_client`         | `idempotentHint`  | Block a client, keeping its config          |
| `delete_client`          | `destructiveHint` | Delete a client — two-step                  |
| `get_client_config`      | `readOnlyHint`    | The client's `.conf` file                   |
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

Both take only `clientId`. A disabled client keeps its configuration and keys but
cannot connect, which makes `disable_client` the reversible alternative to
deleting.

## delete_client

Permanently deletes a client. **Irreversible** — the peer loses access and its
keys cannot be restored.

| Argument       | Type             | Required | Description                                  |
| -------------- | ---------------- | -------- | -------------------------------------------- |
| `clientId`     | positive integer | yes      | Which client                                 |
| `confirmToken` | string           | no       | Token from the first call. Omit on that call |

The flow:

1. Call without `confirmToken`. The tool checks the client exists and returns an
   error result carrying a random token, valid **5 minutes**, bound to that
   client ID.
2. Confirm with the user.
3. Call again with the exact token. The token is consumed on use.

A token issued for one client ID will not delete another, and an expired token
simply starts the flow over.

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
without authenticating**, so it can be sent to the end user. Requires
`WG_ENABLE_ONE_TIME_LINKS` on the wg-easy instance.

Returns the link value and its path (`/cnf/<link>`). Anyone who has the URL
before the intended recipient does gets the config, so share it over a channel
you trust.

## get_server_info

Aggregates three admin endpoints — release/update status, general settings and
the WireGuard interface configuration. Secret fields are
[redacted](/guide/security#admin-secrets-are-redacted).

Takes no arguments. Each section is fetched independently, so one failing
endpoint returns an `error` for that section instead of failing the whole call —
`/api/information` in particular returns `HTTP 500` when the wg-easy container
cannot reach GitHub.
