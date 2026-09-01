# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/wg-easy-mcp.git && cd wg-easy-mcp
npm install
npm test          # the suite runs against a stubbed fetch, so no wg-easy instance is needed
npm run build
```

## Running the integration suite

The unit tests stub `fetch`, so what they establish is that this server sends
the requests its author expected. A wg-easy client is a **WireGuard peer**
rather than a row — creating one generates a key pair, and the configuration
and QR code are generated from it — and none of that is visible through a
fixture. The integration suite spawns the built server over stdio against a
throwaway wg-easy in Docker and calls **every tool in the catalogue**.

```sh
npm run build     # the suite runs dist/index.js, not src/
docker compose -f test/integration/compose.yml up -d
npm run test:integration
docker compose -f test/integration/compose.yml down -v
```

Four things about running wg-easy headlessly, all in `compose.yml` and
`bootstrap.ts`:

- **There is a setup wizard and no way to skip it.** The bootstrap posts the
  two steps the wizard posts. They are numbered **2 and 4**; 1, 3, 5 and 6 are
  404s, because the numbering counts screens rather than endpoints.
- **2FA must stay off.** The wg-easy API supports Basic Authentication only, so
  an account with TOTP enabled cannot be used by this server at all — the
  credentials are accepted and every call then fails.
- **`NET_ADMIN` and `SYS_MODULE` are required**, and their absence is not a
  permission error: the container starts, serves HTTP, and every client call
  answers 500 because `wg show wg0 dump` finds no interface.
- **The compose file switches iptables to the nft backend.** `wg-quick` writes
  its rules with `iptables`, and the image's default alternative is
  iptables-legacy, which needs the `ip_tables` kernel module — a host that is
  nftables-only does not have it, and the symptom is the same distant 500.
  `iptables-nft` works on both kinds of host. `update-alternatives --set`
  refuses because the nft variants are shipped but not registered, so the
  symlinks are rewritten directly.

Two findings the suite **pins rather than endorses**, so that a future fix
makes a test fail rather than pass quietly:

- **`get_client` and `list_clients` return the client's WireGuard private key
  in full.** `get_server_info` redacts private keys; these two do not, so the
  key lands in the model's context and therefore in the transcript.
  `get_client_config` already exists for the case where somebody genuinely
  wants it.
- **`generate_one_time_link` cannot work on wg-easy 15.4.0**: the endpoint
  answers 500, verified with curl outside this server. The tool reports that
  honestly rather than inventing a link.

For poking at one tool by hand, the inspector against the same stack:

```sh
docker compose -f test/integration/compose.yml up -d
WG_EASY_URL=http://127.0.0.1:51821 WG_EASY_USERNAME=integration \
  WG_EASY_PASSWORD=integration-not-a-secret-12 \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs on Node 22 and 24, plus oxlint, prettier, `npm audit`, CodeQL and a Trivy scan of the container image.
- **Comments** explain constraints the code cannot show — not what the next line does.
- **Security-sensitive areas** (config parsing, confirmation tokens, anything that
  builds a request URL): please describe the attack you are defending against, or the
  one your change might open, in the PR text.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/wg-easy-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/wg-easy-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/wg-easy-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
