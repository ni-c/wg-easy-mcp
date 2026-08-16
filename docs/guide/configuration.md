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
It completes the MCP handshake, lists all ten tools, and fails every actual call
with the same setup instructions it printed on stderr.

That is deliberate: registries and sandbox inspectors start the server with no
environment at all to enumerate its tools. Exiting at startup would leave the
listing empty.

## Where the values live

Pass them through your MCP client's `env` block, as shown in
[Connecting clients](/guide/clients). Avoid putting the password on a command
line — it lands in shell history and in `ps` output — and avoid committing it to
a config file that is under version control.
