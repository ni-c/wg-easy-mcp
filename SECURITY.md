# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real credentials, endpoints, client configs or QR codes in a report.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

wg-easy-mcp is a stdio MCP server that administers a real [wg-easy](https://github.com/wg-easy/wg-easy) instance. It authenticates with the instance's admin credentials (`WG_EASY_USERNAME`/`WG_EASY_PASSWORD`), so anything that can read the server's process environment effectively holds VPN admin access: it can create, disable and delete peers and download their private keys via client configs and QR codes.

The MCP client decides which tools get called. Creating, changing, enabling or deleting a client, and issuing a one-time configuration link, ask a person first through MCP elicitation — a dialog the model cannot answer on its behalf. Where the client cannot show one, those five fall back to a two-call `confirm_token`, which only proves the call was made twice with the same arguments. Only connect the server to clients you trust with your VPN.

`WG_EASY_READ_ONLY=true` registers `list_clients`, `get_client` and `get_server_info` only. `get_client_config` and `get_client_qrcode` are reads, but what they read is a client's private key in the clear, so they are suppressed along with the write tools and left out of `WG_EASY_ALLOW_TOOLS=essential`. Name them (`WG_EASY_ALLOW_TOOLS=essential,get_client_config`) where a session should also hand out configurations.

## What the confirmation proves

Both confirmation paths bind an answer to **one operation with one set of arguments**. Neither proves the answer is recent: a sealed `requestState` that opens onto an operation opens onto it whenever it is replayed.

No replay defence is built here, because in this deployment shape there is nothing to replay:

- The sealing key is 32 random bytes per process, and this is a stdio server spawned per session.
- `requestState` only crosses the wire on protocol revision `2026-07-28`. This server does not set `supportedProtocolVersions`, so it takes the SDK's default list, which ends at `2025-11-25`; on that revision the SDK bridges the elicitation server-side and the value never leaves the process.
- The `confirm_token` path is single-use and expires after five minutes.

If any of those three changes — a negotiated `2026-07-28`, or two processes sharing one sealing key — a nonce becomes necessary, first for `create_client` and `generate_one_time_link`.

## Deployment recommendations

- Keep the wg-easy admin UI reachable only from trusted networks (VPN or localhost); the MCP server needs the same URL and inherits that exposure.
- Use a dedicated admin account for the MCP server if your wg-easy version supports multiple users, and rotate its password when revoking access.
- Treat the credentials as secrets: pass them via the MCP client's `env` block, never on the command line or in files checked into version control.
- Client configs and QR codes returned by the tools contain WireGuard private keys — handle tool output accordingly.
