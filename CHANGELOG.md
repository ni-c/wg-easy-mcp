# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

### Fixed

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
