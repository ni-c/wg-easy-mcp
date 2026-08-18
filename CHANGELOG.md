# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

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
