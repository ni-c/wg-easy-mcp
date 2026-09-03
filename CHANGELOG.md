# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

### Added

- Every tool declares an `outputSchema` and answers with `structuredContent`
  beside the text block. A client no longer has to parse prose to use a result.

  The untrusted-data marker travels with it as `untrusted: true` and
  `source: "wg-easy"` fields, not only as a sentence in the text: a client that
  reads the structured half and ignores the text would otherwise receive
  free-form client names, DNS entries and endpoints with no framing at all, and
  the framing is the guard. `delete_client` is the only tool without the marker
  — it reports an id this server was given, not anything the instance sent.

  What wg-easy sends is described with every field optional and unknown fields
  allowed; only what this server builds is exact. The SDK validates every result
  against the schema before it goes out, so a stricter shape would turn a
  wg-easy release that adds a field into a tool that fails outright.

### Changed

- The advertised schemas avoid spellings that are legal JSON Schema and still
  get a tool refused, or its constraint silently dropped, by some MCP clients:
  an open object now writes `"additionalProperties": true` rather than the
  empty schema `{}` zod emits for it; a value that was left untyped is declared
  as what it really is; and a nullable field is written as `anyOf` branches
  rather than `"type": ["string", "null"]`, which several clients read as a
  single type and then drop. What the tools accept and return is unchanged;
  only the way the schema says so is.

- **Three tools answer in a new shape.** `list_clients` returns
  `{count, clients}` instead of a bare array, `get_client_config` returns
  `{configuration}` instead of the raw `.conf` text, and `get_client_qrcode`
  returns `{svg}` instead of the raw markup.

  All three for one reason: an output schema whose root is not an object is
  served to a 2025-era client rewritten as `{result: …}`, so each of those
  tools would have answered in two different shapes depending on which protocol
  revision the client spoke.

- **An oversized answer is shortened as an object, not cut as a string.** The
  longest text field is shortened first — which is what keeps an over-budget QR
  code and a client with a 40 kB name usable — then list entries are dropped,
  and a `truncated` field names each field that was cut with what survived and
  what was there. Cutting the serialized JSON at a byte offset produced text
  that no longer parses, which a text block tolerates and `structuredContent`
  cannot.

  Where neither pass leaves anything to give, the result is now an error rather
  than a half-answer.

- `generate_one_time_link` reports `created: true` in place of
  `success: true`, and its two read-back failures answer in that same shape with
  a `warning` field instead of a bare sentence. The link exists on the instance
  in all three cases, and answering that in three different shapes is how a
  reader ends up believing nothing happened.

- `delete_client` answers `{deleted: <id>}` rather than a sentence.

- The two-call `confirm_token` prompt is an error result. The operation was
  asked for and did not happen, and a tool that declares an output schema may
  not answer without `structuredContent` unless the result is an error. The
  text is unchanged and still carries the token.

### Security

- **`enable_client` now asks a person.** `update_client({clientId, enabled:
true})` has always raised the dialog; `enable_client` did the same state
  change with a bare POST. Whether re-arming a peer was guarded came down to
  which of the two tools the model reached for — and under the recommended
  `WG_EASY_ALLOW_TOOLS=essential`, only the ungated one was registered at all.

  It is not on the list because it destroys something. The key pair it re-arms
  is already installed on the peer, so nothing further has to be handed over for
  that peer to reach every network behind the VPN. This server's own catalogue
  calls `disable_client` the recommended reversible revocation; the undo of a
  revocation cannot be the cheaper call. `disable_client` stays ungated, and is
  now the only write tool that never asks: it can only withdraw access.

- **`WG_EASY_READ_ONLY` no longer leaves key disclosure standing.**
  `get_client_config` and `get_client_qrcode` return a client's `PrivateKey` in
  the clear. Both counted as read tools, so the one coarse switch an operator
  has for putting this server in front of a less trusted session changed nothing
  about them: `list_clients` followed by `get_client_config` yields one
  ready-to-use VPN configuration per peer, in the transcript, unconfirmed.

  They are still reads, and their `readOnlyHint: true` is unchanged and honest —
  nothing on the instance changes. What changed is which set they are in.
  Read-only mode now registers `list_clients`, `get_client` and
  `get_server_info` only, and the two are out of `essential` as well. Where a
  session should also hand out configurations, name the tool:
  `WG_EASY_ALLOW_TOOLS=essential,get_client_config`. That is the rule the
  catalogue already applied to `delete_client` — the variant that cannot be
  taken back has to be named — applied to disclosure rather than destruction.

  The essential preset is six tools now, not eight.

- **A live one-time link is no longer handed out by `list_clients`.** wg-easy
  puts the link token on every row of `GET /api/client`, and `GET /cnf/<token>`
  returns the whole configuration — private key included — with **no login at
  all**. So an ungated read tool that survives read-only mode was returning a
  working, unauthenticated download URL for every client whose link had not yet
  expired. The token is now redacted like other key material; `expiresAt` is
  not, because knowing that a link is live is what a listing is for.
  `generate_one_time_link` still returns the value, deliberately: somebody
  approved it.

### Fixed

- **`generate_one_time_link` reported failure on every successful call.** It
  minted the link and then read it back with `GET /api/client/{id}` — but
  wg-easy joins the one-time link onto the client row in its list query and not
  in its single-client query, so that read answers `oneTimeLink: null` for a
  client that has a live link. The tool then said "the link value was not
  returned by the API", and its own description explained that away as wg-easy
  15.4.0 answering HTTP 500.

  It does not. Against a real 15.4.0 the POST answers `200 {"success":true}`,
  the row is written, and `GET /cnf/<token>` serves the peer's configuration
  unauthenticated for five minutes. The tool now reads the list, returns the
  link with its `expiresAt` — and where the read-back itself fails, says the
  link **was created** and points at the UI where it can be revoked, instead of
  returning a bare transport error a model reads as "nothing happened". The
  integration suite now fetches the minted URL with no credentials and asserts
  it hands back the private key.

- **`clientId` is no longer `Number()`.** `z.coerce.number()` accepted anything
  `Number()` accepts: `{clientId: true}` addressed client 1, `{clientId: ["3"]}`
  addressed client 3. It now takes an integer or a decimal string and rejects
  the rest.

- `WG_EASY_READ_ONLY` accepts `1`, `true` and `yes`, trimmed and
  case-insensitively, where it used to require the exact string `true`. It is
  the switch that fails _towards_ the restriction, so `WG_EASY_READ_ONLY=1`
  silently leaving the write tools registered is the one outcome it must not
  have. `WG_EASY_INSECURE_TLS` keeps the exact-match rule for the same reason
  read the other way round: a typo there fails towards relaxed certificates.

- `docs/guide/faq.md` said read-only mode was not possible ("Not today … this
  server registers all eleven tools unconditionally"). `WG_EASY_READ_ONLY` has
  existed since 0.4.0, and the stale answer was wrong in the unsafe direction.

- **`get_client` no longer returns the client's WireGuard private key.**
  wg-easy's single-client endpoint carries `privateKey` and `preSharedKey` in
  full, and only `get_server_info` was filtering — so asking about a VPN client
  put that client's key into the model's context and therefore into the
  transcript, where it outlives any decision to stop using it.

  `list_clients` does not carry the key on 15.4.0, which is what made this easy
  to miss; the filter is applied to both anyway rather than to the one endpoint
  that happens to need it today. `get_client_config` and `get_client_qrcode`
  still return keys unredacted, deliberately: handing a peer its configuration
  is what they are for, and somebody asked.

  Found by the new integration suite, against a real wg-easy.

### Added

- **A person is asked before four operations, not just told about one.** Where
  the MCP client supports elicitation, `create_client`, `update_client`,
  `delete_client` and `generate_one_time_link` raise a real dialog that the
  model cannot answer on its behalf. Where it does not, they fall back to the
  two-call `confirm_token` — and say which of the two happened rather than
  implying somebody approved.

  The three new ones are not there because they destroy something.
  `create_client` issues a credential that reaches every network behind the VPN;
  `update_client` can move an address or widen `serverAllowedIps`;
  `generate_one_time_link` mints a URL that hands out a private key without
  authentication. Its own annotation had said "which is why the tool is guarded
  instead" since 0.3.0, and it was not.

  The `update_client` approval is bound to the **exact edit**, not to the
  client: approving a rename does not license a later call that widens the
  routes.

### Changed

- **BREAKING:** the confirmation parameter of `delete_client` is now
  `confirm_token`, not `confirmToken`. A caller that passes the old name gets a
  schema error. The prompt tells a model which argument to send, so it has to
  name the one the schema declares — and the whole family spells it the same
  way.
- Deleting no longer keeps its own token table. It uses **`mcp-approval`**, like
  the other fourteen servers: same five-minute lifetime, same one-use token,
  same binding to the exact target — but the dialog comes with it, and the
  timing comparison and the sealed request state are maintained in one place
  rather than fourteen.
- A confirmation prompt now shows the client's **name** on a labelled line under
  the "supplied by the caller, not by this server" heading. A dialog that says
  only "Delete client 5?" is not something a person can act on; a name in the
  server's own sentence would read as the server vouching for it.
- `ELICITATION` switches the dialog off — `false` sends a client that could have
  been asked down the two-call-token path instead. For a scheduled job or a test
  harness, where a dialog is the wrong shape rather than an unwanted one.

  It does **not** remove the guard: there is no setting in which a guarded call
  goes unannounced. Two deliberate rough edges come with it. The variable is
  **not prefixed**, so one `export ELICITATION=false` reaches every MCP server in
  the environment — which is why a server started with it off prints a line
  saying so, and why the fallback text names the server instead of blaming a
  client that was working fine. And a value that is neither `true` nor `false`
  **stops the server**, where `WG_EASY_INSECURE_TLS` beside it fails _off_ on a
  typo: this is the only variable here that defaults to _on_. It is read after
  `WG_EASY_USERNAME` and `WG_EASY_PASSWORD` are wiped from the environment, so
  that exit cannot leave them behind.

- The startup log now also reports `WG_EASY_READ_ONLY`, which it never did, and
  `missingConfigMessage` names the four optional variables it used to omit.
- A `docs/guide/approval.md` page.
- `SECURITY.md` and the security guide now say what the confirmation **proves**:
  binding to one operation with one set of arguments, not freshness. No replay
  defence is built, because the sealing key is per process, the two-call token
  is single-use, and `requestState` only crosses the wire on protocol revision
  `2026-07-28`, which this server does not offer — it takes the SDK's default
  list, which ends at `2025-11-25`. The section names what would have to change
  for that to stop being true.

- Runs on **MCP SDK 2.0**. The wire protocol is unchanged for existing clients:
  the server negotiates the same revision it always did, and a client that
  worked before works now. What changed is the package layout behind it —
  `@modelcontextprotocol/sdk` split into `core`, `server` and `client`, and the
  deprecated Authorization Server helpers are not installed at all.
- The linter is **oxlint** instead of eslint plus typescript-eslint, which lifts
  the TypeScript ceiling: typescript-eslint pins `typescript` below 6.1, so this
  repository was held on TypeScript 6 by its linter rather than by its code.
  It is on TypeScript 7 now. Neither is visible to anyone running the server.
- The tool filter, the host classifier and the documentation-asset generator now
  come from **`mcp-tool-allowlist`**, **`mcp-internal-hosts`** and
  **`svg-asset-set`** rather than from copies kept in this repository — 719
  fewer lines here, and one place to fix each of them. All three have no runtime
  dependencies of their own.
- The shared libraries move to `mcp-approval` 0.7.1, `mcp-tool-allowlist` 0.2.1,
  `mcp-internal-hosts` 0.2.1, `mcp-integration-harness` 0.2.0 and
  `svg-asset-set` 0.2.0. The harness change is visible in the suite: where a
  security path asserted only that a call failed, it now has to say **why** —
  `expectError: true` is also satisfied by a schema rejection, so a renamed
  argument used to keep such a test green while the guard it names went
  unreached.

- stdio is served through `serveStdio`, so the connection's era is negotiated
  on the opening exchange rather than assumed. A client that pins the
  `2026-07-28` era is served it; until now its `server/discover` probe was
  answered with "Method not found" and only `2025-11-25` was on offer. A client
  that speaks the older era sees no change — it is still pinned to one instance
  for the life of the connection, exactly as a hand-wired
  `StdioServerTransport` served it.

### Fixed

- An entry in `WG_EASY_ALLOW_TOOLS` that is not tool-name-shaped is now
  **redacted** in the error rather than quoted back. `WG_EASY_PASSWORD` and
  `WG_EASY_ALLOW_TOOLS` are adjacent lines in every compose file, and a paste
  into the wrong one used to print the credential into the client's log.

## [0.4.0] - 2026-08-27

### Added

- `WG_EASY_ALLOW_TOOLS` and `WG_EASY_DENY_TOOLS` choose which of the 11
  tools are registered. Both take comma-separated tool names or a prefix with a
  trailing `*`, the allow list decides what is in and the deny list is subtracted
  from it, and `WG_EASY_ALLOW_TOOLS=essential` selects a curated eight —
  `get_server_info`, `list_clients`, `get_client`, `create_client`, `get_client_config`, `get_client_qrcode`, `enable_client`, `disable_client`. A model picks the right tool far more reliably from eight than
  from eleven, and every visible tool costs context on every request. Nothing
  changes for an installation that sets neither.

  A filtered tool is not registered at all, so it is absent from `tools/list`
  and answers `tools/call` with "tool not found" — the same cut
  `WG_EASY_READ_ONLY` already makes, not a second, weaker one.

  An entry that matches no tool **stops the server at startup**, naming the
  entry and listing the real names, rather than being ignored: an ignored typo
  leaves a tool missing from `tools/list` with nothing pointing at the cause.

### Changed

- The README now carries the same eight badges, in the same order, as every other
  MCP server in this family, all of them reading from npm rather than hard-coded;
  the opening follows one shape; and the standalone "Full documentation" line is
  gone, because the docs badge three lines above it points at the same page.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.3.3] - 2026-08-26

### Changed

- The check that decides whether `WG_EASY_URL` points somewhere local — and
  therefore whether sending a credential over plain `http` is worth warning
  about — now uses the same host classifier as the other MCP servers in this
  family, in `src/hosts.ts`. The string comparison it replaces missed several
  spellings of the same address: `http://[::ffff:127.0.0.1]`, which `URL`
  canonicalises to `[::ffff:7f00:1]` before any check sees it, and `localhost.`
  with its root label. It also treated `127.example.com` as loopback, because it
  matched on the `127.` prefix, and so stayed quiet about a plain-http URL to a
  public host.

Nothing else changes: this server has no tool that takes a URL, so there is no
request whose target a caller can choose.

## [0.3.2] - 2026-08-18

### Fixed

- The Basic Auth username and password are no longer left in the environment
  when `WG_EASY_URL` is unset. `loadConfig` deleted them only at the very end,
  behind the early return for a missing URL, so in that state they stayed in
  `process.env` for the whole process lifetime — readable in
  `/proc/<pid>/environ` and inherited by every child process. The deletion now
  happens before any branch.
- A malformed `WG_EASY_URL` is no longer echoed into the log. That branch fires
  precisely when the variable does not hold a URL, which most often means a
  credential was pasted into the wrong variable.
- `http://[::1]:…` no longer produces the "plain http to a non-local host"
  warning. `URL.hostname` keeps the brackets around an IPv6 literal, so the
  loopback check never matched that notation.

## [0.3.1] - 2026-08-18

### Fixed

- The architecture diagram no longer depends on the reader's operating system.
  It carried a `prefers-color-scheme` block, which resolves against the OS rather
  than the theme toggle of GitHub or npm — so dark-mode readers on a light OS got
  the light artwork on a dark page. The README now uses `<picture>`, which is
  resolved against the page, and the `<img>` that npm falls back to brings its own
  card instead of a media query.
- The diagram said the server registers ten tools. It registers eleven; the
  documentation was corrected in a previous release but the drawing was not.
- `docs/.vitepress/config.ts` pointed `og:image` at `/og.png`, which did not exist —
  the documentation site had no link preview at all. The file is generated now.

### Changed

- The diagram is generated from a single source, `docs/assets/architecture.source.svg`,
  by `npm run assets`. The four rendered copies had already drifted apart; CI now
  fails if one of them is edited by hand.
- `docs/public/og.png` is generated at exactly 1280x640, GitHub's recommended size
  for a social preview, instead of being drawn by hand.
- The TypeScript major is now parked in `.github/dependabot.yml` with its reason,
  instead of living only as an `@dependabot ignore` on the closed PR #5 — that
  state is invisible to anyone reading the config and is lost if the PR is reopened.

## [0.3.0] - 2026-08-16

### Added

- `Dockerfile` (multi-stage, non-root, stdio entrypoint) and `.dockerignore`,
  so registries that build and introspect the server in a container no longer
  have to guess a build.
- Multi-arch container images (`linux/amd64`, `linux/arm64`) published to
  `ghcr.io/ni-c/wg-easy-mcp` with an SBOM and build provenance. `server.json`
  now lists the OCI package alongside the npm one.
- Documentation site at [wg-easy-mcp.ni-c.de](https://wg-easy-mcp.ni-c.de):
  guide, per-tool reference, environment variables and changelog.
- CI additions: CodeQL, a Trivy scan of the image on both architectures, and
  the GHCR publish job. `main` now requires all of them.
- `CONTRIBUTING.md`, issue forms and GitHub Discussions.

### Changed

- Missing `WG_EASY_URL`/`WG_EASY_USERNAME`/`WG_EASY_PASSWORD` no longer exit at
  startup. The server completes the MCP handshake and lists its tools without
  credentials; they are required when a tool actually calls the API, which then
  fails with the same setup instructions as before. URL validation still exits,
  since a bad URL can leak the credentials.
- Payloads returned by the wg-easy API now carry an explicit untrusted-data
  marker and are capped at 60 000 characters, with the truncation notice naming
  the call that fetches the rest. Client names, DNS entries and endpoints are
  free-form strings, so they are marked as data rather than instructions.
  Server-composed messages, including the delete confirmation, stay unmarked.
- The runtime image no longer contains npm. The entrypoint is plain `node`, and
  npm's vendored dependency tree was the sole source of the container scan's
  HIGH/CRITICAL findings.
- `typescript` 6.0.3, `typescript-eslint` 8.67.0.

### Security

- `WG_EASY_URL` containing embedded credentials (`user:password@host`) is now
  rejected at startup. They bypassed the environment wipe in `loadConfig`, were
  prefixed onto every request path and were echoed verbatim in the startup log.

## [0.2.2] - 2026-08-11

### Added

- Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io)
  as `io.github.ni-c/wg-easy-mcp`; the release workflow publishes registry
  updates automatically via GitHub OIDC (`server.json`, `mcpName` field).
- npm provenance attestations for published packages.
- CodeQL default setup scanning.

### Changed

- The repository is now public.
- Dependency majors: zod 4 (first release including it; vitest 4 and
  eslint 10 in the dev toolchain).

## [0.2.1] - 2026-08-11

### Added

- Release workflow: pushing a `v*` tag runs the test suite, publishes to npm
  via trusted publishing (OIDC, no token) and creates a GitHub release from
  the changelog entry.
- CI: weekly scheduled runs, `npm audit` job (fails on high/critical),
  coverage reporting with thresholds on the Node 24 run.
- Dependabot updates for npm dependencies (minor/patch grouped) and pinned
  GitHub Actions.
- Tests for the configuration loader (URL validation, credential cleanup,
  plain-http warning).

## [0.2.0] - 2026-08-11

Security-hardening release based on an internal code audit.

### Changed

- **Breaking:** `delete_client` now uses a two-step confirmation-token flow
  (`confirmToken` parameter) instead of `confirm=true`. The first call returns
  a random, short-lived token; only a second call with that token deletes the
  client. The client name is no longer echoed in tool responses.
- `WG_EASY_INSECURE_TLS` now uses a request-scoped undici dispatcher instead
  of setting `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide.
- `get_server_info` redacts secret fields (`privateKey`, `preSharedKey`,
  `password`, session/TOTP secrets) from admin API responses.
- Upstream error bodies are truncated to 2000 characters and HTML error pages
  are omitted from error results.
- `WG_EASY_URL` is validated (http/https only); a warning is printed for
  plain-http URLs to non-local hosts. README examples switched to `https://`.
- API requests now have a 15 s timeout and no longer follow redirects.
- Credentials are removed from `process.env` after loading the configuration.
- Tool descriptions of `get_client_config`, `get_client_qrcode` and
  `generate_one_time_link` now flag their output as sensitive.
- CI: least-privilege `permissions`, actions pinned to commit SHAs, Node
  matrix 22/24. Minimum supported Node.js version raised to 22 (20 is EOL).

## [0.1.0] - 2026-08-05

### Added

- Initial release targeting the wg-easy v15 REST API (Basic Authentication).
- Client management tools: `list_clients`, `get_client`, `create_client`,
  `update_client` (partial updates via get-merge-post), `enable_client`,
  `disable_client`, `delete_client` (guarded by a `confirm` parameter),
  `get_client_config`, `get_client_qrcode`, `generate_one_time_link`.
- `get_server_info` aggregating `/api/information`, `/api/admin/general` and
  `/api/admin/interface` with per-section error tolerance.
- Configuration via `WG_EASY_URL`, `WG_EASY_USERNAME`, `WG_EASY_PASSWORD`,
  optional `WG_EASY_INSECURE_TLS`.

<!-- #endregion changelog -->
