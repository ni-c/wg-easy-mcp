# Configuration

Everything is configured through environment variables; there is no config file.
The full table lives in the [environment reference](/reference/environment) —
this page covers the decisions behind them.

## The URL

`WG_EASY_URL` is the base URL of the wg-easy web UI, without a trailing path:

```
https://vpn.example.com:51821
```

Trailing slashes are stripped. The server validates the URL at startup and
**exits** — rather than warning — in three cases:

| Rejected                            | Why                                                             |
| ----------------------------------- | --------------------------------------------------------------- |
| Anything `new URL()` cannot parse   | A malformed URL turns request paths into guesswork              |
| A scheme other than `http`/`https`  | Nothing else can carry the API                                  |
| Embedded credentials (`user:pass@`) | They would be logged at startup and prefixed onto every request |

Plain `http` to a non-loopback host only produces a warning, because it is a
legitimate setup when the connection already runs inside a tunnel. It is still
worth reading that warning: with plain http, both the Basic Auth credentials
and every WireGuard private key the server returns travel in the clear.

## Credentials

`WG_EASY_USERNAME` and `WG_EASY_PASSWORD` are the wg-easy **web UI login** of an
admin account. Two consequences:

- **2FA must be off** for that account. The API speaks Basic Authentication only,
  and a TOTP-protected account returns `HTTP 401` on every call.
- The credentials are **deleted from `process.env`** once the config is loaded,
  so a later crash dump or a child process cannot read them back out.

::: warning There is no read-only account
wg-easy admin credentials grant full VPN administration. This server has no way
to hand out less than that — see [Security](/guide/security).
:::

## Self-signed certificates

`WG_EASY_INSECURE_TLS=true` accepts certificates that do not validate. It is
implemented as a **scoped undici dispatcher** used only for the wg-easy
connection, not `NODE_TLS_REJECT_UNAUTHORIZED`, so nothing else the process does
loses certificate validation.

It is still the second-best answer. Prefer issuing the wg-easy certificate from
an internal CA and trusting that CA on the machine running the server; then leave
this unset.

## Starting without credentials

If any of the three required variables is missing, the server **still starts**.
It completes the MCP handshake, lists all eleven tools, and fails every actual call
with the same setup instructions it printed on stderr.

That is deliberate: registries and sandbox inspectors start the server with no
environment at all to enumerate its tools. Exiting at startup would leave the
listing empty.

## Where the values live

Pass them through your MCP client's `env` block, as shown in
[Connecting clients](/guide/clients). Avoid putting the password on a command
line — it lands in shell history and in `ps` output — and avoid committing it to
a config file that is under version control.

## Turning the approval dialog off

`create_client`, `update_client`, `delete_client` and `generate_one_time_link`
ask a person through MCP elicitation before they act. `ELICITATION=false` takes
them to the two-call token instead. It does not remove the guard; there is no
setting in which a guarded call goes unannounced.

The variable deliberately carries no `WG_EASY_` prefix, which means it reaches
every MCP server in the same environment, and — unlike `WG_EASY_INSECURE_TLS` — a
value it does not recognise **stops the server** rather than failing off. See
[Asking a person](/guide/approval).

## Choosing the tools that load

Read-only mode is one cut, along a line this server drew for you.
`WG_EASY_ALLOW_TOOLS` and `WG_EASY_DENY_TOOLS` let you draw your own:

```sh
WG_EASY_ALLOW_TOOLS=essential
WG_EASY_ALLOW_TOOLS=list_clients,get_client_config
WG_EASY_DENY_TOOLS=delete_client,create_client
```

Why bother, when all eleven work: a model chooses the right tool far more
reliably from a handful than from a long list, and every tool it can see costs
context on every single request. If this is the only MCP server in a session,
eleven is fine. If it is one of six, it is not.

**The syntax.** Comma-separated entries. An entry is either an exact tool name or
a prefix with a trailing `*` — `list_*` matches every tool whose name starts with
`list_`. Entries are trimmed and case-insensitive, empty ones are ignored, and an
empty value counts as unset. Nothing else is a pattern: `*_x` and `list_*_x` are
rejected rather than silently matching nothing.

**`essential`** is a curated preset of six:

`get_server_info`, `list_clients`, `get_client`, `create_client`, `enable_client`, `disable_client`.

Left out on purpose: `delete_client` and `update_client`, because both change
more than an onboarding step does, and `get_client_config`, `get_client_qrcode`
and `generate_one_time_link`, because all three hand a peer's private key to
whoever receives the answer. Handing out a configuration is a normal part of
onboarding, so the preset does make that one call harder — deliberately. Name
the tool where the same session should also deliver the config.

It composes — naming a tool alongside it puts that one back, and
`WG_EASY_DENY_TOOLS` takes one away:

```
WG_EASY_ALLOW_TOOLS=essential,get_client_config
```

**Both together.** `WG_EASY_ALLOW_TOOLS` decides what is in;
`WG_EASY_DENY_TOOLS` is then subtracted from the result. With only a deny list,
everything else stays.

**A name that matches nothing stops the server**, with the offending entry and the
list of real names. That is deliberate: the alternative is a tool quietly missing
from `tools/list`, and nobody traces an absence back to an environment variable.
The same applies to a pattern that matches no tool.

**With read-only mode**, the write tools are not registered at all, so naming
one explicitly in `WG_EASY_ALLOW_TOOLS` is an error that says so — rather than
calling a tool unknown when it plainly exists. A _pattern_ that covers write
tools is fine and simply contributes nothing, and
`WG_EASY_ALLOW_TOOLS=essential` narrows to the read half of the preset.

::: tip It is the same cut, not a second one
A filtered tool is never registered, so it is absent from `tools/list` and
unknown to `tools/call` alike — exactly what `WG_EASY_READ_ONLY` does to a
write tool. There is no "hidden but callable" state to reason about.
:::
