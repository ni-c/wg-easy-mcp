# wg-easy-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for administering [wg-easy](https://github.com/wg-easy/wg-easy) (WireGuard Easy) instances.

Lets MCP clients like Claude Code, Claude Desktop or Codex manage your WireGuard VPN: list, create, update, enable/disable and delete clients, fetch configuration files and QR codes, and inspect the server status — all through the wg-easy v15 REST API.

## Requirements

- Node.js ≥ 20
- A running **wg-easy v15+** instance
- **2FA (TOTP) must be disabled** for the account used by this server — the wg-easy API only supports Basic Authentication and does not work with 2FA enabled

> **Note:** The wg-easy REST API is [not yet declared stable](https://wg-easy.github.io/wg-easy/latest/advanced/api/) and may change between releases. This server targets wg-easy v15.

## Configuration

Configuration is provided via environment variables:

| Variable               | Required | Description                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `WG_EASY_URL`          | yes      | Base URL of the wg-easy web UI, e.g. `http://vpn.example.com:51821` |
| `WG_EASY_USERNAME`     | yes      | Username of a wg-easy admin account                                 |
| `WG_EASY_PASSWORD`     | yes      | Password of that account                                            |
| `WG_EASY_INSECURE_TLS` | no       | Set to `true` to accept self-signed TLS certificates                |

## Installation

### Claude Code

```bash
claude mcp add wg-easy -s user \
  -e WG_EASY_URL=http://vpn.example.com:51821 \
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
        "WG_EASY_URL": "http://vpn.example.com:51821",
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
env = { WG_EASY_URL = "http://vpn.example.com:51821", WG_EASY_USERNAME = "admin", WG_EASY_PASSWORD = "your-password" }
```

### From source

```bash
git clone https://github.com/ni-c/wg-easy-mcp.git
cd wg-easy-mcp
npm install
npm run build
# then use `node /path/to/wg-easy-mcp/dist/index.js` as the command
```

## Tools

| Tool                               | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `list_clients`                     | List all WireGuard clients with status and traffic statistics                               |
| `get_client`                       | Get the full details of a single client                                                     |
| `create_client`                    | Create a new client (`name`, optional `expiresAt`)                                          |
| `update_client`                    | Update a client; only the provided fields are changed                                       |
| `enable_client` / `disable_client` | Enable or disable a client                                                                  |
| `delete_client`                    | Permanently delete a client — requires `confirm=true`                                       |
| `get_client_config`                | Get the client's WireGuard `.conf` file                                                     |
| `get_client_qrcode`                | Get the client configuration as a QR code (SVG)                                             |
| `generate_one_time_link`           | Generate a one-time config download link (requires one-time links to be enabled in wg-easy) |
| `get_server_info`                  | Release/update status, general settings and interface configuration                         |

### Safety

- `delete_client` refuses to run without an explicit `confirm=true` parameter and reports the client name, so an MCP client can ask the user for confirmation first.
- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- Keep in mind that `get_client_config` and `get_client_qrcode` return the client's **private key** — treat tool output as sensitive.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # eslint + prettier check
```

## License

[MIT](LICENSE)
