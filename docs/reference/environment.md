# Environment variables

| Variable               | Required | Default | Description                                                                    |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `WG_EASY_URL`          | yes      | —       | Base URL of the wg-easy web UI, e.g. `https://vpn.example.com:51821`           |
| `WG_EASY_USERNAME`     | yes      | —       | Username of a wg-easy admin account (2FA must be disabled)                     |
| `WG_EASY_PASSWORD`     | yes      | —       | Password of that account                                                       |
| `WG_EASY_INSECURE_TLS` | no       | `false` | `true` accepts self-signed certificates, scoped to the wg-easy connection      |
| `WG_EASY_READ_ONLY`    | no       | `false` | `true` registers only the read tools                                           |
| `WG_EASY_ALLOW_TOOLS`  | no       | —       | Tool names, `list_*` prefixes or `essential`; only these register              |
| `WG_EASY_DENY_TOOLS`   | no       | —       | Same syntax; subtracted from whatever the allow list left                      |
| `ELICITATION`          | no       | `true`  | `false` replaces the approval dialog with the two-call token. **Not prefixed** |

There is no configuration file and no command-line flag; these are the whole
surface. The reasoning behind each is in [Configuration](/guide/configuration).

## Validation at startup

| Condition                                          | Result                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| A required variable is missing                     | Warning; the server starts and lists tools                    |
| `WG_EASY_URL` does not parse                       | **Exit 1**                                                    |
| `WG_EASY_URL` scheme is not `http`/`https`         | **Exit 1**                                                    |
| `WG_EASY_URL` contains `user:password@`            | **Exit 1**                                                    |
| `WG_EASY_URL` is plain http to a non-loopback host | Warning about unencrypted credentials and keys                |
| `WG_EASY_INSECURE_TLS=true`                        | Warning that certificate validation is relaxed                |
| `ELICITATION` is neither `true` nor `false`        | **Exit 1**, naming both valid values                          |
| `ELICITATION=false`                                | One line saying guarded tools fall back to the two-call token |

All diagnostics go to **stderr**, which is where MCP stdio servers must log —
stdout carries the protocol.

## `ELICITATION`

Whether a client that _can_ show a dialog is asked before `create_client`,
`update_client`, `delete_client` or `generate_one_time_link` acts. `false` takes
the two-call-token path instead — it does not remove the guard, and a server
started with it off prints one line saying so.

Two ways it differs from every other variable here:

- **No prefix.** One `export ELICITATION=false` reaches every MCP server in the
  same environment, not just this one. That is the point of it and also its risk;
  see [Asking a person](/guide/approval).
- **Fatal on anything else.** Where `WG_EASY_INSECURE_TLS` fails _off_ on a typo,
  this one stops the server with exit code 1. It is the only variable here that
  defaults to _on_, and a typo that fell back would leave the dialog running while
  you believed it was off.

Values are trimmed and matched case-insensitively. It is read _after_
`WG_EASY_USERNAME` and `WG_EASY_PASSWORD` are deleted from `process.env`, so the
fatal path cannot leave the credentials sitting there for a crash reporter.

## Notes

- Only the exact string `true` enables `WG_EASY_INSECURE_TLS`; anything else,
  including `1` and `yes`, leaves it off.
- Trailing slashes on `WG_EASY_URL` are stripped.
- `WG_EASY_USERNAME` and `WG_EASY_PASSWORD` are **deleted from `process.env`**
  once the configuration has been read.
- The wg-easy connection uses a 15-second request timeout and refuses to follow
  redirects.

## Narrowing the tool list

| Variable              | Required | Description                                                       |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `WG_EASY_ALLOW_TOOLS` | no       | Tool names, `list_*` prefixes or `essential`; only these register |
| `WG_EASY_DENY_TOOLS`  | no       | Same syntax; subtracted from whatever the allow list left         |

Both are comma-separated. Each entry is either an exact tool name or a prefix with
a single trailing `*`. Entries are trimmed and matched case-insensitively; empty
entries are ignored, and a value that is empty or only whitespace counts as unset —
`WG_EASY_ALLOW_TOOLS=` in a compose file does not mean "allow nothing".
`essential` is recognised only in the allow list, and selects `get_server_info`, `list_clients`, `get_client`, `create_client`, `get_client_config`, `get_client_qrcode`, `enable_client`, `disable_client`.

**An entry that matches no tool aborts startup**, naming the entry and listing the
valid names, as does a malformed pattern such as `*_x` or `list_*_x`. The
alternative — ignoring the entry — leaves a tool missing from `tools/list` with
nothing pointing at the cause. If both lists together remove everything, the server
refuses to start rather than offering an empty tool list.

Under `WG_EASY_READ_ONLY`, an exact write-tool name in the allow list is an
error naming the read-only setting rather than "unknown tool"; a pattern covering
write tools is accepted and merely contributes nothing, with a warning on stderr.
Deny entries are exempt: denying an already-suppressed tool is how a defensive
list is written.
