# Getting started

## Requirements

- **Node.js ≥ 22** (22 and 24 are covered by CI)
- A running **wg-easy v15+** instance
- An admin account on it with **2FA (TOTP) disabled**

::: warning 2FA breaks the API
The wg-easy REST API only supports Basic Authentication. If TOTP is enabled for
the account you configure here, every call fails with `HTTP 401`. Use an account
without 2FA, and see [Security](/guide/security) for what that account grants.
:::

## 1. Collect the credentials

You need three values:

| Value              | Where it comes from                                                      |
| ------------------ | ------------------------------------------------------------------------ |
| `WG_EASY_URL`      | The URL you open the wg-easy UI on, e.g. `https://vpn.example.com:51821` |
| `WG_EASY_USERNAME` | The admin account's username                                             |
| `WG_EASY_PASSWORD` | That account's password                                                  |

::: tip Use https
With a plain-`http` URL, the Basic Auth credentials and every WireGuard private
key the server returns travel unencrypted. The server prints a warning unless
the host is loopback. See [Configuration](/guide/configuration) for the
self-signed-certificate case.
:::

## 2. Register the server

The quickest path, if you use Claude Code:

```sh
claude mcp add wg-easy -s user \
  -e WG_EASY_URL=https://vpn.example.com:51821 \
  -e WG_EASY_USERNAME=admin \
  -e WG_EASY_PASSWORD=your-password \
  -- npx -y wg-easy-mcp
```

For Claude Desktop, Codex, a container or a source checkout, see
[Connecting clients](/guide/clients).

## 3. Verify it works

Ask your client to list the tools; you should see eleven. Then try a read-only
call — `list_clients` is the safe one to start with:

> List my WireGuard clients with their status.

Without a client at hand, the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
does the same from a shell:

```sh
npx -y @modelcontextprotocol/inspector --cli npx -y wg-easy-mcp \
  --method tools/list
```

## Troubleshooting the first call

| Symptom                                    | Cause                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| `missing required environment variable(s)` | The client did not pass the env block through             |
| `HTTP 401` with a 2FA hint                 | TOTP is enabled on the account, or the password is wrong  |
| `fetch failed` / timeout after 15 s        | `WG_EASY_URL` is unreachable from where the server runs   |
| `WG_EASY_URL must not contain credentials` | Move `user:pass@` out of the URL into the two env vars    |
| Tools list fine but every call fails       | Credentials are missing — that combination is intentional |

More in the [FAQ](/guide/faq).
