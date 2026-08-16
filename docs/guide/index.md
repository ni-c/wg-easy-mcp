# What is wg-easy-mcp?

[wg-easy](https://github.com/wg-easy/wg-easy) is a self-hosted web UI for WireGuard.
`wg-easy-mcp` puts its REST API behind the [Model Context Protocol](https://modelcontextprotocol.io),
so an MCP client — Claude Code, Claude Desktop, Codex, the MCP Inspector — can
administer the VPN directly.

In practice that means asking for things like:

- _"Which VPN clients haven't connected in the last month?"_
- _"Create a client called `laptop-lena` that expires at the end of the quarter."_
- _"Disable `old-contractor` and show me the remaining enabled clients."_
- _"Give me the QR code for `phone-tom`."_

## How it fits together

The server speaks MCP over **stdio** and talks to wg-easy over its **HTTP REST
API** using Basic Authentication — the same credentials as the web UI login. It
holds no database and caches nothing except short-lived delete confirmation
tokens; wg-easy stays the single source of truth.

## What it is not

- **Not a WireGuard implementation.** Everything routes through wg-easy's API;
  key generation, IP allocation and the interface itself stay wg-easy's job.
- **Not a wg-easy installer.** You need a running wg-easy v15 instance first.
- **Not multi-instance.** One server process targets exactly one `WG_EASY_URL`.
  Register the server twice with different environments to manage two VPNs.

## Version support

This server targets **wg-easy v15 and newer**. The wg-easy REST API is
[not yet declared stable](https://wg-easy.github.io/wg-easy/latest/advanced/api/),
so a wg-easy upgrade can change endpoint shapes. If a tool starts returning
schema errors after a wg-easy update, that is the first thing to check.

## Next steps

- [Getting started](/guide/getting-started) — install it and make the first call
- [Connecting clients](/guide/clients) — Claude Code, Claude Desktop, Codex, Docker
- [Security](/guide/security) — what the credentials grant and how output is guarded
- [Tools reference](/reference/tools) — every tool, argument by argument
