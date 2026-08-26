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

## Through mcp-hub

[mcp-hub](https://mcp-hub.ni-c.de) serves many stdio MCP servers from one container
behind a single HTTPS endpoint, so wg-easy-mcp can be reached from clients that cannot
spawn a local process — ChatGPT connectors, Claude on the web, Cursor — without a
container, a hostname and an OAuth stack of its own.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you
already have, with the hub's own filter alongside:

```json
{
  "mcpServers": {
    "wg-easy": {
      "command": "npx",
      "args": ["-y", "wg-easy-mcp"],
      "env": { "WG_EASY_ALLOW_TOOLS": "essential" },
      "denyTools": ["delete_client"]
    }
  }
}
```

`allowTools` and `denyTools` are the hub's **own** per-server filter and take exact
tool names or `list_*` prefixes — the same syntax as the two environment variables,
so a list moves between them verbatim. What does **not** move is `essential`: that
preset is a wg-easy-mcp feature and belongs in `env` as shown.
`"allowTools": ["essential"]` would be a name the hub cannot resolve.

The two compose, and it is worth knowing which does what: the server registers what
its environment variables allow, and the hub exposes what its arrays allow.
Filtering in the server is the tighter of the two — the tool is never built.

Register `https://your-host/wg-easy/mcp` as a connector and you
get this server alone. Register the hub's `/hub` endpoint instead and you reach
_every_ server behind it through six meta-tools, which is the answer worth having
once you run several of these at once.

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
