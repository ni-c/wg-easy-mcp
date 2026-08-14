# wg-easy-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/wg-easy-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/wg-easy-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/wg-easy-mcp)](https://www.npmjs.com/package/wg-easy-mcp)
[![npm downloads](https://img.shields.io/npm/dm/wg-easy-mcp)](https://www.npmjs.com/package/wg-easy-mcp)
[![node](https://img.shields.io/node/v/wg-easy-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/wg-easy-mcp)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for administering [wg-easy](https://github.com/wg-easy/wg-easy) (WireGuard Easy) instances.

Lets MCP clients like Claude Code, Claude Desktop or Codex manage your WireGuard VPN: list, create, update, enable/disable and delete clients, fetch configuration files and QR codes, and inspect the server status — all through the wg-easy v15 REST API.

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

> **Use `https://`.** With a plain-`http` URL the Basic Auth credentials and all
> WireGuard private keys travel unencrypted; the server prints a warning unless
> the host is local. For self-signed certificates prefer a proper internal CA
> over `WG_EASY_INSECURE_TLS`.

Without credentials the server still starts and lists its tools (so registries
and inspectors can introspect it), but every tool call fails with setup
instructions instead of reaching the wg-easy API.

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

```bash
docker build -t wg-easy-mcp .
docker run -i --rm \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  wg-easy-mcp
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
        "wg-easy-mcp"
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

| Tool                               | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `list_clients`                     | List all WireGuard clients with status and traffic statistics                               |
| `get_client`                       | Get the full details of a single client                                                     |
| `create_client`                    | Create a new client (`name`, optional `expiresAt`)                                          |
| `update_client`                    | Update a client; only the provided fields are changed                                       |
| `enable_client` / `disable_client` | Enable or disable a client                                                                  |
| `delete_client`                    | Permanently delete a client — two-step, guarded by a confirmation token                     |
| `get_client_config`                | Get the client's WireGuard `.conf` file                                                     |
| `get_client_qrcode`                | Get the client configuration as a QR code (SVG)                                             |
| `generate_one_time_link`           | Generate a one-time config download link (requires one-time links to be enabled in wg-easy) |
| `get_server_info`                  | Release/update status, general settings and interface configuration (secrets redacted)      |

### Safety

- `delete_client` is a two-step operation: the first call returns a random confirmation token (valid for 5 minutes, bound to the client ID) and only a second call with that exact token deletes the client. Unlike a plain `confirm=true` parameter, the token cannot be guessed or pre-supplied by the model or by injected text.
- `get_server_info` redacts secret fields (`privateKey`, `preSharedKey`, `password`, session/TOTP secrets) from the admin API responses.
- Upstream error bodies are truncated and HTML error pages (reverse proxies) are dropped before being returned to the MCP client.
- `WG_EASY_INSECURE_TLS` only relaxes certificate validation for the wg-easy connection — it does not disable TLS verification process-wide.
- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- Keep in mind that `get_client_config` and `get_client_qrcode` return the client's **private key**, and a `generate_one_time_link` URL allows an unauthenticated config download — treat tool output as sensitive.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # eslint + prettier check
```

### Releasing

1. Bump the version in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`

The release workflow runs the test suite, publishes to npm (via [trusted publishing](https://docs.npmjs.com/trusted-publishers), no token, with provenance), creates a GitHub release from the changelog entry and updates the entry in the official [MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.ni-c/wg-easy-mcp`, via GitHub OIDC).

## License

[MIT](LICENSE)
