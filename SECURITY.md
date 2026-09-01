# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real credentials, endpoints, client configs or QR codes in a report.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

wg-easy-mcp is a stdio MCP server that administers a real [wg-easy](https://github.com/wg-easy/wg-easy) instance. It authenticates with the instance's admin credentials (`WG_EASY_USERNAME`/`WG_EASY_PASSWORD`), so anything that can read the server's process environment effectively holds VPN admin access: it can create, disable and delete peers and download their private keys via client configs and QR codes.

The MCP client decides which tools get called. Creating, changing or deleting a client, and issuing a one-time configuration link, ask a person first through MCP elicitation — a dialog the model cannot answer on its behalf. Where the client cannot show one, those four fall back to a two-call `confirm_token`, which only proves the call was made twice with the same arguments. Only connect the server to clients you trust with your VPN.

## Deployment recommendations

- Keep the wg-easy admin UI reachable only from trusted networks (VPN or localhost); the MCP server needs the same URL and inherits that exposure.
- Use a dedicated admin account for the MCP server if your wg-easy version supports multiple users, and rotate its password when revoking access.
- Treat the credentials as secrets: pass them via the MCP client's `env` block, never on the command line or in files checked into version control.
- Client configs and QR codes returned by the tools contain WireGuard private keys — handle tool output accordingly.
