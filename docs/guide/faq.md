# FAQ & troubleshooting

## Every call returns HTTP 401

Two causes, in order of likelihood:

1. **2FA is enabled** on the account. The wg-easy API speaks Basic
   Authentication only and rejects TOTP-protected accounts. The error message
   says so explicitly. Disable TOTP for that account or use another one.
2. The username or password is wrong. They are the **web UI login**, not an API
   token — wg-easy has no separate API credentials.

## The server starts but every tool call fails with "missing required environment variable(s)"

The server started without credentials, which it does on purpose so registries
can enumerate its tools. Your MCP client is not passing the `env` block through.
Check the config for the client you are using in
[Connecting clients](/guide/clients), and remember that `claude mcp add` needs
each variable as its own `-e` flag before the `--`.

## `get_server_info` reports an error for the `information` section

`/api/information` fetches the latest wg-easy release from GitHub, and it returns
`HTTP 500` when the container has no outbound internet access. The tool collects
its three sections independently, so `general` and `interface` still come back
normally. If you do not need release-update status, this is cosmetic; otherwise,
give the wg-easy container egress.

## Can I make it read-only?

Not today. wg-easy has no read-only account, and this server registers all ten
tools unconditionally. What you can do:

- use an MCP client that asks before running non-read-only tools — the tools
  carry `readOnlyHint`, `destructiveHint` and `idempotentHint` annotations for
  exactly this,
- rely on `delete_client`'s two-step confirmation, which no single call can
  bypass.

## Why did `update_client` not change the field I asked for?

`update_client` only accepts the fields in its schema. Anything else — including
wg-easy's `preUp`/`postUp`/`preDown`/`postDown` shell hooks, which run as root on
the server — is dropped before the request is built, deliberately and with a test
covering it. If you need a hook changed, do it in the wg-easy UI.

Note also that the wg-easy update endpoint requires the **complete** client
object, so the tool reads the current state and merges your changes into it. A
field you did not mention keeps its current value.

## The tool output starts with "[untrusted data]"

That is the marker described in [Security](/guide/security). It tells the model
that client names and similar free-form fields are data, not instructions. The
actual payload follows after a blank line.

## The output says "(truncated, N more characters)"

An upstream payload exceeded the 60 000-character budget. The message names the
call that fetches the remainder — usually narrowing `list_clients` with `filter`,
or switching to `get_client` for one specific client.

## Does it work with wg-easy v14 or older?

No. It targets the v15 REST API. Older versions expose a different, session-based
API that this server does not implement.

## A wg-easy upgrade broke a tool

Likely. The wg-easy API is
[not declared stable](https://wg-easy.github.io/wg-easy/latest/advanced/api/) and
its shapes change between releases. Please
[open an issue](https://github.com/ni-c/wg-easy-mcp/issues) with the wg-easy
version and the failing tool — redact keys, hostnames and IPs first.

## Where do I ask something not covered here?

[GitHub Discussions](https://github.com/ni-c/wg-easy-mcp/discussions) for
questions and ideas; [Issues](https://github.com/ni-c/wg-easy-mcp/issues) for
reproducible problems; and
[private reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new)
for anything security-related.
