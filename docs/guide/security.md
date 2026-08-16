# Security

This page is the prose version of the repository's
[SECURITY.md](https://github.com/ni-c/wg-easy-mcp/blob/main/SECURITY.md).
For reporting a vulnerability, use
[private vulnerability reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new) —
never a public issue.

## What the credentials grant

The server authenticates with a wg-easy **admin** login. wg-easy has no
read-only role, so there is no configuration in which this server holds less
than full VPN administration. Concretely, anything able to read this process's
environment can:

- create, disable and delete peers,
- download any peer's configuration file and QR code, both of which contain that
  peer's **private key**,
- mint one-time links that let an unauthenticated visitor download a config.

Treat the process environment, the MCP client's config file and the tool output
as three copies of the same secret.

## Who decides what gets called

The MCP client does. This server enforces the confirmation handshake and the
redaction rules described below, but it cannot tell a legitimate request from
one a model was talked into. Connect it only to clients you would trust with the
VPN itself.

## Guard rails in the server

### Deleting takes two calls

`delete_client` will not delete on the first call. It verifies the client exists,
then returns a random 128-bit token that is **bound to that client ID** and valid
for **five minutes**. Only a second call carrying that exact token deletes.

The reason it is a token and not a `confirm: true` flag: a boolean is something
the model can set by itself on the first call, including when it has been steered
there by text it read somewhere. A random value that only exists in a previous
tool response cannot be produced that way.

The confirmation message quotes the client **ID and nothing else** — never the
client's name — because that text is read by a model and a name is attacker-supplied.

### Admin secrets are redacted

`get_server_info` reads wg-easy's admin endpoints, which return the server
configuration. Keys named `privateKey`, `preSharedKey`, `password`,
`passwordHash`, `sessionSecret` or anything starting with `totp` are replaced
with `[redacted]` at every nesting level before the result is returned.

Note the deliberate asymmetry: `get_client_config` and `get_client_qrcode`
return private keys **unredacted**, because handing a peer its configuration is
the point of those tools. Their descriptions say so.

### Upstream content is marked untrusted

Client names, DNS entries and endpoints are free-form strings chosen by whoever
administers the VPN. Everything the wg-easy API returns is prefixed with an
explicit untrusted-data marker telling the model to treat the block as data to
report rather than instructions to follow, and is capped at 60 000 characters so
a single oversized field cannot flood the context.

### Transport

- Requests carry a **15-second timeout** and `redirect: 'error'` — following a
  redirect would hand the `Authorization` header to whatever host it points at.
- `WG_EASY_INSECURE_TLS` is a **scoped undici dispatcher**, so relaxed
  certificate validation applies to the wg-easy connection only and never
  process-wide.
- A URL carrying embedded credentials is rejected at startup rather than logged.
- Credentials are removed from `process.env` after the config is read.

### Error output

Upstream error bodies are truncated to 2 000 characters, and HTML error pages —
the usual output of a reverse proxy or WAF — are dropped entirely instead of
being pasted into the model's context.

## Deployment recommendations

- Keep the wg-easy admin UI reachable only from trusted networks. The MCP server
  uses the same URL and inherits exactly that exposure.
- Give the server its own admin account where wg-easy supports multiple users,
  and rotate its password when you revoke access.
- Pass credentials through the client's `env` block — not a command line, where
  they land in shell history and `ps`.
- Prefer an internal CA over `WG_EASY_INSECURE_TLS`.

## Supply chain

Releases are published to npm via
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) with
[provenance](https://docs.npmjs.com/generating-provenance-statements) — no
long-lived token exists to leak. Container images ship an SBOM and
`provenance: mode=max`. CI runs `npm audit`, CodeQL and a Trivy scan of the
image on every push and once a week; the runtime image contains no npm at all.
