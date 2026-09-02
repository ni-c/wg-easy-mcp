# wg-easy-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/wg-easy-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/wg-easy-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/wg-easy-mcp)](https://www.npmjs.com/package/wg-easy-mcp)
[![npm downloads](https://img.shields.io/npm/dm/wg-easy-mcp)](https://www.npmjs.com/package/wg-easy-mcp)
[![node](https://img.shields.io/node/v/wg-easy-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/wg-easy-mcp)](LICENSE)
[![container](https://img.shields.io/badge/ghcr.io-ni--c%2Fwg--easy--mcp-blue)](https://github.com/ni-c/wg-easy-mcp/pkgs/container/wg-easy-mcp)
[![docs](https://img.shields.io/badge/docs-wg--easy--mcp.ni--c.de-informational)](https://wg-easy-mcp.ni-c.de)
[![sponsor](https://img.shields.io/badge/sponsor-ni--c-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ni-c)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for administering [wg-easy](https://github.com/wg-easy/wg-easy) (WireGuard Easy) instances.

Lets MCP clients like Claude Code, Claude Desktop or Codex manage your WireGuard VPN: list, create, update, enable/disable and delete clients, fetch configuration files and QR codes, and inspect the server status — all through the wg-easy v15 REST API.

Eleven tools is the ceiling, not the floor: `WG_EASY_ALLOW_TOOLS=essential`
registers a curated six instead, and a model picks the right tool far more
reliably from six than from eleven — see
[choosing which tools load](#choosing-which-tools-load).

<!-- <picture> is resolved against the colour scheme of the page showing it, so GitHub
     picks the variant that matches its own theme toggle. npm strips <picture> and
     <source> when it sanitises the README and keeps the <img>, which is why that
     fallback brings its own dark card instead of relying on a media query. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://wg-easy-mcp.ni-c.de/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://wg-easy-mcp.ni-c.de/architecture-light.svg">
  <img src="https://wg-easy-mcp.ni-c.de/architecture.svg" alt="An MCP client speaks stdio to wg-easy-mcp, which calls the wg-easy v15 REST API over HTTPS with Basic Authentication" width="800">
</picture>

## Requirements

- Node.js ≥ 22
- A running **wg-easy v15+** instance
- **2FA (TOTP) must be disabled** for the account used by this server — the wg-easy API only supports Basic Authentication and does not work with 2FA enabled

> **Note:** The wg-easy REST API is [not yet declared stable](https://wg-easy.github.io/wg-easy/latest/advanced/api/) and may change between releases. This server targets wg-easy v15.

## Configuration

Configuration is provided via environment variables:

| Variable               | Required | Description                                                                             |
| ---------------------- | -------- | --------------------------------------------------------------------------------------- |
| `WG_EASY_URL`          | yes      | Base URL of the wg-easy web UI, e.g. `https://vpn.example.com:51821`                    |
| `WG_EASY_USERNAME`     | yes      | Username of a wg-easy admin account                                                     |
| `WG_EASY_PASSWORD`     | yes      | Password of that account                                                                |
| `WG_EASY_INSECURE_TLS` | no       | Set to `true` to accept self-signed TLS certificates (scoped to the wg-easy connection) |
| `WG_EASY_ALLOW_TOOLS`  | no       | Comma-separated tool names, `list_*` prefixes, or `essential` for a curated preset      |
| `WG_EASY_DENY_TOOLS`   | no       | Same syntax; removed from whatever `WG_EASY_ALLOW_TOOLS` left                           |
| `ELICITATION`          | no       | `false` replaces the approval dialog with the two-call token. **Not prefixed**          |

> **Use `https://`.** With a plain-`http` URL the Basic Auth credentials and all
> WireGuard private keys travel unencrypted; the server prints a warning unless
> the host is local. For self-signed certificates prefer a proper internal CA
> over `WG_EASY_INSECURE_TLS`.

Without credentials the server still starts and lists its tools (so registries
and inspectors can introspect it), but every tool call fails with setup
instructions instead of reaching the wg-easy API.

### Choosing which tools load

`WG_EASY_ALLOW_TOOLS` and `WG_EASY_DENY_TOOLS` take comma-separated tool names;
a trailing `*` matches a whole family. `essential` is a curated preset of
six: `get_server_info`, `list_clients`, `get_client`, `create_client`, `enable_client`, `disable_client`.

`get_client_config`, `get_client_qrcode` and `generate_one_time_link` are not in
it, and neither is `delete_client`: all four either destroy something
irreversibly or hand out a peer's private key. Name them where you want them.

```sh
WG_EASY_ALLOW_TOOLS=essential
WG_EASY_ALLOW_TOOLS=essential,get_client_config
WG_EASY_ALLOW_TOOLS=list_clients,get_client_config
WG_EASY_DENY_TOOLS=delete_client,create_client
```

An entry that matches no tool aborts startup and names it, so a typo cannot
silently hide a tool — an absent tool is not something anyone traces back to an
environment variable. A filtered tool is never registered, so it is absent from
`tools/list` and unknown to `tools/call` alike, exactly like a write tool under
`WG_EASY_READ_ONLY`.

If you run several of these servers at once, [mcp-hub](https://mcp-hub.ni-c.de)
is the other answer — its `/hub` endpoint replaces every server's tools with six
meta-tools.

## Installation

### Claude Code

```bash
claude mcp add wg-easy -s user \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  -- npx -y wg-easy-mcp
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wg-easy": {
      "command": "npx",
      "args": ["-y", "wg-easy-mcp"],
      "env": {
        "WG_EASY_URL": "https://vpn.example.com:51821",
        "WG_EASY_USERNAME": "admin",
        "WG_EASY_PASSWORD": "your-password"
      }
    }
  }
}
```

### Codex

Add to your `~/.codex/config.toml`:

```toml
[mcp_servers.wg-easy]
command = "npx"
args = ["-y", "wg-easy-mcp"]
env = { WG_EASY_URL = "https://vpn.example.com:51821", WG_EASY_USERNAME = "admin", WG_EASY_PASSWORD = "your-password" }
```

### From source

```bash
git clone https://github.com/ni-c/wg-easy-mcp.git
cd wg-easy-mcp
npm install
npm run build
# then use `node /path/to/wg-easy-mcp/dist/index.js` as the command
```

### Docker

A multi-arch image (`linux/amd64`, `linux/arm64`) with an SBOM and build provenance is published to GitHub Container Registry:

```bash
docker run -i --rm \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  ghcr.io/ni-c/wg-easy-mcp:latest
```

The image talks MCP over stdio, so clients need `docker run -i` (no port is
exposed):

```json
{
  "mcpServers": {
    "wg-easy": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "WG_EASY_URL",
        "-e",
        "WG_EASY_USERNAME",
        "-e",
        "WG_EASY_PASSWORD",
        "ghcr.io/ni-c/wg-easy-mcp:latest"
      ],
      "env": {
        "WG_EASY_URL": "https://vpn.example.com:51821",
        "WG_EASY_USERNAME": "admin",
        "WG_EASY_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tools

| Tool                        | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `list_clients`              | List all WireGuard clients with status and traffic statistics                          |
| `get_client`                | Get the full details of a single client                                                |
| `create_client` 👤          | Create a new client (`name`, optional `expiresAt`)                                     |
| `update_client` 👤          | Update a client; only the provided fields are changed                                  |
| `enable_client` 👤          | Let a client connect again — re-arms a key pair already installed on the peer          |
| `disable_client`            | Block a client; it keeps its configuration and keys                                    |
| `delete_client` 👤          | Permanently delete a client                                                            |
| `get_client_config`         | Get the client's WireGuard `.conf` file                                                |
| `get_client_qrcode`         | Get the client configuration as a QR code (SVG)                                        |
| `generate_one_time_link` 👤 | Generate a one-time config download link, valid five minutes                           |
| `get_server_info`           | Release/update status, general settings and interface configuration (secrets redacted) |

👤 asks a person through MCP elicitation · falls back to a two-call
`confirm_token` where the client cannot show a dialog.

### Safety

- **Five tools ask a person, not just the model.** `create_client`,
  `update_client`, `enable_client`, `delete_client` and `generate_one_time_link`
  raise a real dialog through MCP elicitation where the client supports it. Only
  one of the five destroys anything — the others issue a VPN credential, re-arm
  one, can widen a route, and mint an unauthenticated URL that hands out a
  private key. `disable_client` is the one write tool that never asks: it can
  only withdraw access. Where the
  client cannot show a dialog they fall back to a random token valid for 5
  minutes and bound to the exact target (for `update_client`, to the exact
  edit), which proves the call was made twice with the same arguments and
  nothing more. `ELICITATION=false` takes that fallback deliberately; it never
  removes the guard. See
  [Asking a person](https://wg-easy-mcp.ni-c.de/guide/approval).
- **Key material is redacted everywhere it is not the point.** `privateKey`, `preSharedKey`, `password` and session/TOTP secrets are replaced with `[redacted]` at every nesting level — in `get_server_info`'s admin responses, which carry the WireGuard _server_ key, and in `list_clients` and `get_client`, which carry each client's _own_ key. Live one-time-link tokens are redacted from the same two, because `GET /cnf/<token>` serves the whole configuration with no login at all; `expiresAt` survives, so a listing still shows that a link is live. `get_client_config`, `get_client_qrcode` and `generate_one_time_link` are the deliberate exceptions: handing a peer its configuration is what they are for, and somebody asked.
- Everything the wg-easy API returns carries an explicit **untrusted-data marker** and a 60 000-character budget. Client names, DNS entries and endpoints are free-form strings, so they are marked as data to report rather than instructions to follow, and a single oversized field cannot flood the model's context.
- A `WG_EASY_URL` containing embedded credentials (`user:password@host`) is rejected at startup — they would otherwise be echoed in the startup log and prefixed onto every request.
- Upstream error bodies are truncated and HTML error pages (reverse proxies) are dropped before being returned to the MCP client.
- `WG_EASY_INSECURE_TLS` only relaxes certificate validation for the wg-easy connection — it does not disable TLS verification process-wide.
- **`WG_EASY_READ_ONLY=true` registers `list_clients`, `get_client` and `get_server_info`, and nothing else.** `get_client_config` and `get_client_qrcode` are reads and still not in that set: what they read is a client's private key in the clear, and a read-only mode that leaves key disclosure standing is not the mode its name promises.
- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- Keep in mind that `get_client_config` and `get_client_qrcode` return the client's **private key**, and a `generate_one_time_link` URL allows an unauthenticated config download — treat tool output as sensitive.

The full trust model is in [SECURITY.md](SECURITY.md) and, in prose, at [wg-easy-mcp.ni-c.de/guide/security](https://wg-easy-mcp.ni-c.de/guide/security).

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # oxlint + prettier check
npm run test:coverage
```

CI runs the suite on Node 22 and 24 and adds `npm audit`, CodeQL and a Trivy scan of the container image on both architectures. See [CONTRIBUTING.md](CONTRIBUTING.md).

The documentation site lives in `docs/` with its own manifest:

```bash
cd docs && npm install && npm run dev
```

### Releasing

1. Bump the version in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`

The release workflow runs the test suite, publishes to npm (via [trusted publishing](https://docs.npmjs.com/trusted-publishers), no token, with provenance), creates a GitHub release from the changelog entry and updates the entry in the official [MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.ni-c/wg-easy-mcp`, via GitHub OIDC). The container image is published to GHCR by the CI workflow on the same tag.

`server.json` lists both an npm and an OCI package; the registry job syncs the version into both before publishing. If it ever fails, fix `main` and re-run `mcp-registry.yml` via `workflow_dispatch` — re-running the tag job checks out the old tree.

## License

[MIT](LICENSE)
