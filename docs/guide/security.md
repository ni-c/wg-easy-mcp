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

### Five tools ask a person

`create_client`, `update_client`, `enable_client`, `delete_client` and
`generate_one_time_link` put the question to a **person** before they act,
through MCP elicitation — a dialog the model cannot answer on its behalf, and
which nothing proceeds without.

Only one of the five destroys anything. The other four are on the list because
`destructiveHint` is the wrong axis for what they do:

- `create_client` issues a credential that reaches every network behind the VPN.
- `update_client` can move an address or widen `serverAllowedIps`. Its approval
  is bound to the **exact edit**, so approving a rename does not license a later
  call that widens the routes.
- `enable_client` re-arms a key pair that is already installed on a peer. If
  `disable_client` is the reversible revocation this server recommends — and its
  catalogue says it is — then enabling is the undo of a revocation. It was
  ungated until 0.5.0, which also made the guard on `update_client` avoidable:
  `update_client({enabled: true})` asked and `enable_client` did not, so the
  same state change was guarded or not depending on which tool the model picked.
- `generate_one_time_link` mints a URL that hands out a client's full
  configuration — private key included — to anyone who has it, without
  authentication.

`disable_client` deliberately stays ungated. It only ever withdraws access, and
putting a dialog between an operator and cutting off a peer is the wrong place
for one.

Where the client cannot show a dialog, all five fall back to a random 128-bit
token bound to the same target and valid for **five minutes**; only a second call
carrying that exact token acts. A boolean would not do: a model can set one by
itself on the first call, including when it has been steered there by text it
read somewhere.

Be clear about what the token proves, because this server is: **the call was made
twice with the same arguments, and nothing more.** A model can read it out of the
first result and quote it back in the same turn. The fallback text says so rather
than implying somebody approved, and names whether it was the client that could
not be asked or the operator who switched the dialog off with
`ELICITATION=false`.

The prompt shows the client's **name** on a labelled line under a heading saying
those values did not come from this server. A dialog that says only "Delete
client 5?" is not something a person can act on; a name in the server's own
sentence would read as the server vouching for it.

See [Asking a person](/guide/approval).

### Key material is redacted

Everything the wg-easy API hands back is filtered before it is returned. Keys
named `privateKey`, `preSharedKey`, `password`, `passwordHash`, `sessionSecret`
or anything starting with `totp` are replaced with `[redacted]` at every nesting
level.

That covers two different secrets. `get_server_info` reads the admin endpoints,
which carry the WireGuard **server** private key. `get_client` reads a single
client, and wg-easy returns that client's **own** private key and pre-shared
key in full — while `list_clients` does not, which is what made the leak easy
to miss. Until the integration suite found it, `get_client` passed the key
straight through. A key that reaches the model is in the transcript, where it
outlives any decision to stop using it.

The filter is applied to both, rather than to the one endpoint that happens to
carry the key today.

One-time links are redacted on the read path too. `GET /api/client` carries the
link token on every row, and `GET /cnf/<token>` returns the whole configuration
with **no login at all** — so `list_clients` used to hand out a working download
URL for any client whose link had not yet expired. The token is replaced;
`expiresAt` is not, because knowing that a link is live is exactly what a
listing is for.

Note the deliberate asymmetry: `get_client_config` and `get_client_qrcode`
return private keys **unredacted**, and `generate_one_time_link` returns the
link token, because handing a peer its configuration is the point of those
tools. Their descriptions say so. The difference is that somebody asked for it.

### Read-only mode suppresses key disclosure

`WG_EASY_READ_ONLY=true` registers `list_clients`, `get_client` and
`get_server_info`, and nothing else.

`get_client_config` and `get_client_qrcode` are reads — nothing on the instance
changes — and they are **not** in that set, because what they read is a client's
`PrivateKey` in the clear. Read-only mode is the one coarse switch an operator
has for putting this server in front of a less trusted session, and a mode that
leaves key disclosure standing is not the mode its name promises: `list_clients`
followed by `get_client_config` yields one ready-to-use VPN configuration per
peer, in the transcript, with no confirmation anywhere.

They are left out of `WG_EASY_ALLOW_TOOLS=essential` for the same reason. Where
a session should also hand out configurations, name the tool:

```
WG_EASY_ALLOW_TOOLS=essential,get_client_config
```

This is the rule the catalogue already applies to `delete_client` — the variant
that cannot be taken back has to be named explicitly — applied to disclosure
rather than to destruction. Before 0.5.0 both tools counted as read tools, so
`WG_EASY_READ_ONLY` changed nothing about them.

### The two-call token proves binding, not freshness

Where a client cannot show a dialog, a guarded tool hands back a `confirm_token`
and acts only on a second call carrying it. Where a client _can_, the reply
comes back sealed (HMAC) and carries the resource key of the operation it
answered.

Both mechanisms bind an answer to **one operation with one set of arguments**.
Neither proves that the answer is _recent_. A sealed `requestState` that opens
onto the same operation opens onto it whenever it is replayed, and the library
says so.

In this server that gap is closed by the surroundings rather than by a
mechanism, and it is worth writing down which surroundings, because they are
what a future change could remove:

- The sealing key is 32 random bytes **per process**. This is a stdio server
  spawned per session, so a state sealed in one session cannot be opened in the
  next.
- `requestState` only travels over the wire on protocol revision `2026-07-28`.
  On `2025-11-25` the SDK bridges the elicitation server-side and the value never
  leaves the process. This server offers neither revision explicitly: it does not
  set `supportedProtocolVersions`, so it takes the SDK's default list, which ends
  at `2025-11-25`.
- The `confirm_token` path is single-use by construction — `ConfirmationStore`
  consumes the token — and expires after five minutes.

So there is nothing here to replay, and **no replay defence has been built**. If
this server ever negotiates `2026-07-28`, or serves two halves of one flow from
two processes with a shared key, this section stops being true and a nonce is
needed. That applies first to `create_client` and `generate_one_time_link`,
whose approvals are the ones worth stealing.

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
