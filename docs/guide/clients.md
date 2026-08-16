# Connecting clients

Every method below starts the same process and speaks MCP over stdio. Pick one.

## Claude Code

```sh
claude mcp add wg-easy -s user \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  -- npx -y wg-easy-mcp
```

`-s user` registers it for every project. Drop it to scope the server to the
current project instead.

## Claude Desktop

Add to `claude_desktop_config.json`:

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

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.wg-easy]
command = "npx"
args = ["-y", "wg-easy-mcp"]
env = { WG_EASY_URL = "https://vpn.example.com:51821", WG_EASY_USERNAME = "admin", WG_EASY_PASSWORD = "your-password" }
```

## MCP Inspector

Useful for poking at tools without a model in the loop:

```sh
npx -y @modelcontextprotocol/inspector --cli npx -y wg-easy-mcp \
  --method tools/call --tool-name list_clients
```

## Docker

A multi-arch image (amd64 and arm64) is published to GitHub Container Registry
with an SBOM and build provenance:

```sh
docker run -i --rm \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  ghcr.io/ni-c/wg-easy-mcp:latest
```

The image talks stdio, so it needs `docker run -i` and exposes no port:

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

::: tip Reaching a VPN-only instance
If wg-easy is not exposed publicly — which is the recommended setup — the
container needs a route to it. `--network host` is the blunt fix; attaching it
to the same Docker network as wg-easy is the tidier one.
:::

## From source

```sh
git clone https://github.com/ni-c/wg-easy-mcp.git
cd wg-easy-mcp
npm install
npm run build
```

Then use `node /path/to/wg-easy-mcp/dist/index.js` as the command in any of the
configurations above.

## Pinning a version

`npx -y wg-easy-mcp` follows the latest release. To pin, name the version
(`npx -y wg-easy-mcp@0.3.0`) or use the matching image tag
(`ghcr.io/ni-c/wg-easy-mcp:0.3.0`).
