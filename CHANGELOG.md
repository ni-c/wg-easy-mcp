# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
