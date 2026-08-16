# Environment variables

| Variable               | Required | Default | Description                                                               |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------- |
| `WG_EASY_URL`          | yes      | —       | Base URL of the wg-easy web UI, e.g. `https://vpn.example.com:51821`      |
| `WG_EASY_USERNAME`     | yes      | —       | Username of a wg-easy admin account (2FA must be disabled)                |
| `WG_EASY_PASSWORD`     | yes      | —       | Password of that account                                                  |
| `WG_EASY_INSECURE_TLS` | no       | `false` | `true` accepts self-signed certificates, scoped to the wg-easy connection |

There is no configuration file and no command-line flag; these are the whole
surface. The reasoning behind each is in [Configuration](/guide/configuration).

## Validation at startup

| Condition                                          | Result                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| A required variable is missing                     | Warning; the server starts and lists tools     |
| `WG_EASY_URL` does not parse                       | **Exit 1**                                     |
| `WG_EASY_URL` scheme is not `http`/`https`         | **Exit 1**                                     |
| `WG_EASY_URL` contains `user:password@`            | **Exit 1**                                     |
| `WG_EASY_URL` is plain http to a non-loopback host | Warning about unencrypted credentials and keys |
| `WG_EASY_INSECURE_TLS=true`                        | Warning that certificate validation is relaxed |

All diagnostics go to **stderr**, which is where MCP stdio servers must log —
stdout carries the protocol.

## Notes

- Only the exact string `true` enables `WG_EASY_INSECURE_TLS`; anything else,
  including `1` and `yes`, leaves it off.
- Trailing slashes on `WG_EASY_URL` are stripped.
- `WG_EASY_USERNAME` and `WG_EASY_PASSWORD` are **deleted from `process.env`**
  once the configuration has been read.
- The wg-easy connection uses a 15-second request timeout and refuses to follow
  redirects.
