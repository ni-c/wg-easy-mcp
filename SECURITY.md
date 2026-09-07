# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real credentials, endpoints, client configs or QR codes in a report.

Only the latest release and the current `main` branch receive security fixes.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

wg-easy-mcp is a stdio MCP server that administers a real [wg-easy](https://github.com/wg-easy/wg-easy) instance. It authenticates with the instance's admin credentials (`WG_EASY_USERNAME`/`WG_EASY_PASSWORD`), so anything that can read the server's process environment effectively holds VPN admin access: it can create, disable and delete peers and download their private keys via client configs and QR codes.

The MCP client decides which tools get called. Creating, changing, enabling or deleting a client, and issuing a one-time configuration link, ask a person first through MCP elicitation — a dialog the model cannot answer on its behalf. Where the client cannot show one, those five fall back to a two-call `confirm_token`, which only proves the call was made twice with the same arguments. Only connect the server to clients you trust with your VPN.

`WG_EASY_READ_ONLY=true` registers `list_clients`, `get_client` and `get_server_info` only. `get_client_config` and `get_client_qrcode` are reads, but what they read is a client's private key in the clear, so they are suppressed along with the write tools and left out of `WG_EASY_ALLOW_TOOLS=essential`. Name them (`WG_EASY_ALLOW_TOOLS=essential,get_client_config`) where a session should also hand out configurations.

## What the confirmation proves

Both confirmation paths bind an answer to **one operation with one set of arguments**, and both are single-use.

On protocol revision `2026-07-28` the dialog is a _return value_: a sealed `requestState` travels out through the client and comes back carrying the answer. A seal proves binding — "this answer belongs to this question" — and nothing else, so on its own the same state and the same ticked box would replay for the state's whole lifetime. That matters most for the two calls that grant rather than destroy: `create_client` issues a credential that reaches every network behind the VPN, and `generate_one_time_link` mints an unauthenticated download URL for a peer's private key.

This server does negotiate that revision. `src/index.ts` serves through `serveStdio`, whose opening exchange selects `2025-11-25` or `2026-07-28` per connection — so the replay path is reachable, not hypothetical, and an earlier version of this document argued the opposite from a `supportedProtocolVersions` default that the entry point stopped taking when it moved off `StdioServerTransport`.

What defends it is `mcp-approval` ≥ 0.8.1: every sealed state carries a nonce that is **spent the first time an answer arrives with it**, accepted or declined. A state presented a second time counts as no answer at all and produces a fresh question, the same way the `confirm_token` path spends its token. The token path is single-use and expires after five minutes.

The honest residual: the record of spent states lives in the process, next to the 32-byte sealing key that is also generated per process. A restart forgets both — which ends the session the states belonged to as well — and a deployment that served the two halves of one flow from two processes would have neither. This is a stdio server spawned per session, so that shape does not arise here.

## Deployment recommendations

- Keep the wg-easy admin UI reachable only from trusted networks (VPN or localhost); the MCP server needs the same URL and inherits that exposure.
- Use a dedicated admin account for the MCP server if your wg-easy version supports multiple users, and rotate its password when revoking access.
- Treat the credentials as secrets: pass them via the MCP client's `env` block, never on the command line or in files checked into version control.
- Client configs and QR codes returned by the tools contain WireGuard private keys — handle tool output accordingly.
