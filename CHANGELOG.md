# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
