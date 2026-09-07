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

Everything the wg-easy API hands back is filtered before it is returned. A key
is sensitive by what it **ends in**, matched on the name with `_` and `-`
removed and lower-cased: `password`, `passwordHash`, `passwd`, `passphrase`,
`secret`, `token`, `apiKey`, `privateKey`, `preSharedKey`, plus anything
starting with `totp`. The value is replaced with `[redacted]` at every nesting
level.

The suffix rule is there because an exact list is only as good as the backend's
naming. `GET /api/admin/general` carries the argon2 hash of the metrics token as
`metricsPassword`, and `password` matched `password` and not that — so until
0.6.0 the hash reached the model through a tool whose description promises the
opposite. Every `<prefix>Secret` wg-easy invents next is covered now without
anybody having to notice it.

`key` is deliberately **not** a suffix. It would take `publicKey` — which is how
a peer is identified, and is public — and every `*_key` identifier with it.

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

### What binds an approval, and what makes it stale

Where a client cannot show a dialog, a guarded tool hands back a `confirm_token`
and acts only on a second call carrying it. Where a client _can_, the reply
comes back sealed (HMAC) and carries the resource key of the operation it
answered.

Both mechanisms bind an answer to **one operation with one set of arguments**. A
seal on its own does not prove the answer is _recent_: a sealed `requestState`
that opens onto an operation opens onto it whenever it is replayed, and the
library says so.

That path is reachable here. `src/index.ts` serves through `serveStdio`, whose
opening exchange selects `2025-11-25` or `2026-07-28` per connection, and on the
later revision the dialog _is_ the return value — the sealed state travels out
through the client and comes back with the answer.

::: warning This section used to say the opposite
Until 0.6.0 it argued that the server "does not set `supportedProtocolVersions`,
so it takes the SDK's default list, which ends at `2025-11-25`". That stopped
being true when the entry point moved from a hand-wired `StdioServerTransport`
to `serveStdio`, which negotiates both eras — and the sentence stayed. A claim
in a security document that names a class or a protocol revision is only as good
as the last time somebody checked it against the source.
:::

What closes the gap is a mechanism, not the surroundings: `mcp-approval` ≥ 0.8.1
puts a nonce in every sealed state and **spends it the first time an answer
arrives** — accepted or declined. The same state presented again counts as no
answer at all and produces a fresh question, exactly as the `confirm_token` path
consumes its token. The token path is single-use through `ConfirmationStore` and
expires after five minutes.

Two things are still worth writing down, because a future change could remove
them:

- The record of spent states and the 32-byte sealing key both live **in the
  process**. A restart forgets them — along with the session they belonged to.
- A deployment that served the two halves of one flow from two processes with a
  shared key would have neither guarantee. This is a stdio server spawned per
  session, so that shape does not arise.

### Upstream content is marked untrusted

Client names, DNS entries and endpoints are free-form strings chosen by whoever
administers the VPN. Everything the wg-easy API returns is prefixed with an
explicit untrusted-data marker telling the model to treat the block as data to
report rather than instructions to follow, and is capped at 60 000 characters —
measured on the text that is actually emitted — so a single oversized field
cannot flood the context.

Those strings are also **cleaned**: C0 and C1 control characters, DEL and the
BiDi override and isolate characters are removed from every value and every
field name in a record. An ESC begins a terminal escape sequence in whatever
renders the transcript, and a right-to-left override reorders the line around
it — a client name is an odd place to find either.

Two answers are exempt and stay byte-exact, because they have to work as files:
`get_client_config` and `get_client_qrcode`. A control character in one of those
is reported in a `warning` field instead of being removed.

### Nothing the instance sends is taken on trust

A JSON body is read with a TypeScript cast, which checks nothing, and the SDK
validates every answer against the tool's output schema before it leaves. Those
two facts meet badly: an `id` spelled as a string, a `1e999` in `transferRx` —
`Infinity` after `JSON.parse`, which `z.number()` refuses — or a numeric `name`
in one record used to answer the **whole** `list_clients` with
`Output validation error` and no cause.

Every field the schema types is now read with a check of that exact type at the
boundary, and a value that fails it is left out rather than passed on. A list
entry that is not a record at all is left out and **counted** in `skipped`, not
dropped in silence.

### Transport

- Requests carry a **15-second timeout** and `redirect: 'error'` — following a
  redirect would hand the `Authorization` header to whatever host it points at.
- A successful body is refused above **8 MiB** — a declared `content-length`
  before a byte is read, otherwise the reader is cancelled at the ceiling. The
  timeout does not cover this: it is spent once the headers arrive, so a body
  that never ends was a process that never answered again.
- The **status is read before the body**, and a failed one is read under its own
  64 KiB ceiling that cuts rather than refuses — so a `401` behind a reverse
  proxy's login page is still a `401` with a credential hint.
- A **refused login is repeated from memory for ten seconds** rather than
  retried. Every tool call carries the admin credentials, so every call is a
  login attempt, and `401` is the answer a model reads as transient. Only `401`;
  a `403` is a permission, not a guess.
- `WG_EASY_INSECURE_TLS` is a **scoped undici dispatcher**, so relaxed
  certificate validation applies to the wg-easy connection only and never
  process-wide.
- A URL carrying embedded credentials is rejected at startup rather than logged,
  and only its origin and path are kept — a query or fragment would otherwise be
  glued in front of every request path.
- Credentials are removed from `process.env` after the config is read.

### Error output

Upstream error bodies are labelled `(untrusted text from the instance)`,
stripped of control characters and cut at 200 characters; HTML error pages — the
usual output of a reverse proxy or WAF — are dropped entirely instead of being
pasted into the model's context. The label and the cut matter because an error
result is built from a message, and no result budget measures one.

### Diagnostics do not echo values

A startup message that says "got `<value>`" prints whatever was pasted into the
wrong variable, to stderr, which is the MCP client's log. `WG_EASY_URL` sits one
line above `WG_EASY_PASSWORD` in every compose file, and `ELICITATION` is
unprefixed and in the same block.

So the "not a valid URL" message names no value; the non-http(s) message names
no **scheme**, because a hexadecimal key with a colon after it is a valid URL
whose scheme is the key; and `ELICITATION` quotes only a short word-shaped value
(`/^[A-Za-z0-9_-]{1,12}$/`, so a genuine typo is still shown) and describes
anything else by its length alone.

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
`provenance: mode=max`. CI runs `npm audit`, CodeQL, a Trivy scan of the image
and `actions/dependency-review-action` — which checks what a pull request
_adds_, rather than the tree as it stands — on every push and once a week.

Both jobs that hold an OIDC token install with `--ignore-scripts`, so no
dependency's lifecycle hook runs while a credential that can publish this
package is available, and `mcp-publisher` is pinned to a release tag with its
published sha256 checked rather than fetched from `releases/latest`. The runtime
image contains no npm, corepack or yarn at all.
