import { internalHostKind } from 'mcp-internal-hosts';

export interface Config {
  /**
   * Base URL of the wg-easy instance, e.g. `https://vpn.example.com:51821`.
   * May be undefined together with the credentials: the server still starts
   * and lists its tools, every API call then fails with
   * {@link missingConfigMessage}.
   */
  url: string | undefined;
  username: string | undefined;
  password: string | undefined;
  insecureTls: boolean;
  /** When true, only the read-only tools are registered at all. */
  readOnly: boolean;
  /**
   * Whether a client that *can* show a dialog is asked before a guarded tool
   * acts. `ELICITATION=false` turns the dialog off — the guard stays and falls
   * back to the two-call token, so there is no setting in which a guarded call
   * goes unannounced.
   */
  elicitation: boolean;

  /**
   * Raw value of `WG_EASY_ALLOW_TOOLS` — comma-separated tool names, `list_*`
   * prefixes, or `essential`. Kept unparsed on purpose: this file is a mirror of
   * the environment, and the names can only be checked against the tool
   * catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `WG_EASY_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
}

/** Shown when credentials are missing — on startup and on every API call. */
export function missingConfigMessage(missing: string[]): string {
  return (
    `missing required environment variable(s): ${missing.join(', ')}\n` +
    'Required: WG_EASY_URL (e.g. https://vpn.example.com:51821), WG_EASY_USERNAME, WG_EASY_PASSWORD\n' +
    'Optional: WG_EASY_READ_ONLY=true to expose only read tools, ' +
    'WG_EASY_INSECURE_TLS=true to accept self-signed certificates, ' +
    'WG_EASY_ALLOW_TOOLS / WG_EASY_DENY_TOOLS to choose which tools load, ' +
    'ELICITATION=false to fall back to the two-call confirmation token'
  );
}

/** Names of the required environment variables that are unset in `config`. */
export function missingConfigKeys(config: Config): string[] {
  return [
    !config.url && 'WG_EASY_URL',
    !config.username && 'WG_EASY_USERNAME',
    !config.password && 'WG_EASY_PASSWORD',
  ].filter((v): v is string => Boolean(v));
}

/**
 * Reads `ELICITATION` — deliberately unprefixed, and deliberately fatal on
 * anything it does not recognise.
 *
 * Unprefixed: environment variables are process-wide, so this is one switch for
 * every server in the same environment. That is also its risk, which is why a
 * server started with it off says so on its startup line.
 *
 * Fatal: this is the first variable of the family that defaults to *on*. The
 * others fail open on a typo, which is the safe direction for them. Here a typo
 * would leave the dialog running while the operator believes it is off — and an
 * operator who believes that has no way to find out.
 */
export function parseElicitation(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  console.error(
    `wg-easy-mcp: ELICITATION must be "true" or "false" — got ${describe(raw ?? '')}. ` +
      'Refusing to start rather than guess.'
  );
  process.exit(1);
}

/**
 * A wrong value, said back to the operator without printing a secret.
 *
 * The purpose of the message is to show somebody their typo, so a short
 * word-shaped value is quoted — "got \"off\"" is the whole point of the line.
 * Anything else is described by its length: this variable is unprefixed and
 * sits in the same block as the credentials in every compose file, so the value
 * that lands here wrongly is as likely to be a pasted token as a typo, and a
 * token printed to stderr is a token in the MCP host's log.
 */
function describe(raw: string): string {
  return /^[A-Za-z0-9_-]{1,12}$/.test(raw)
    ? `"${raw}"`
    : `a ${raw.length}-character value`;
}

/**
 * Trailing slashes removed, walking an index.
 *
 * `replace(/\/+$/, '')` is the same line and quadratic: the pattern is tried
 * from every position of the run, and every attempt consumes the rest of it —
 * 60 000 slashes with one character behind them measured 1.2 s, on the startup
 * path. `slice` in a loop has the same shape in bytes. One walk, one slice.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return value.slice(0, end);
}

/**
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must
 * be able to complete the MCP handshake and answer `tools/list` without them
 * so registries and inspectors can introspect it. A malformed `WG_EASY_URL`
 * still exits, because that one can leak the credentials.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.WG_EASY_URL;
  const username = env.WG_EASY_USERNAME;
  const password = env.WG_EASY_PASSWORD;
  const insecureTls = env.WG_EASY_INSECURE_TLS === 'true';
  // Deliberately more forgiving than `WG_EASY_INSECURE_TLS` above, and the
  // asymmetry is the safety argument, not an oversight: a misspelt value here
  // fails *towards* the restriction, so `WG_EASY_READ_ONLY=1` in a compose file
  // must not silently unlock the write tools. The insecure-TLS switch fails the
  // other way, so it keeps the exact-match rule.
  const readOnly = /^(1|true|yes)$/i.test(env.WG_EASY_READ_ONLY?.trim() ?? '');
  const allowTools = env.WG_EASY_ALLOW_TOOLS;
  const denyTools = env.WG_EASY_DENY_TOOLS;

  // Don't keep the credentials in the environment for the process lifetime — they
  // are visible to child processes and in /proc/<pid>/environ. This happens before
  // any branch on purpose: the paths below either exit or return early, and "the
  // URL is missing or malformed" is exactly the state in which someone runs an
  // inspector or trips a crash reporter, so it is the last moment they should
  // still be sitting in the environment. Everything after this point reads the
  // locals above, never `env` again.
  delete env.WG_EASY_USERNAME;
  delete env.WG_EASY_PASSWORD;

  // After the deletes, deliberately: this one can exit the process, and an exit
  // above would leave the credentials in the environment for whatever runs next.
  const elicitation = parseElicitation(env.ELICITATION);

  const missing = [
    !url && 'WG_EASY_URL',
    !username && 'WG_EASY_USERNAME',
    !password && 'WG_EASY_PASSWORD',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`wg-easy-mcp: ${missingConfigMessage(missing)}`);
  }

  if (!url) {
    return {
      url: undefined,
      username,
      password,
      insecureTls,
      readOnly,
      elicitation,
      allowTools,
      denyTools,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The value itself is not echoed: this branch fires precisely when the
    // variable does not hold what was expected, and a password pasted into the
    // wrong environment variable would otherwise be printed verbatim into the
    // MCP host's log.
    console.error(
      'wg-easy-mcp: WG_EASY_URL is not a valid URL (e.g. https://vpn.example.com)'
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // The scheme is not printed. A hexadecimal key with a colon after it *is* a
    // URL, and its scheme is the key — so the branch that fires on "this is not
    // the value I expected" would print the pasted secret in full, which is the
    // exact thing the "not a valid URL" branch above was written not to do.
    console.error(
      'wg-easy-mcp: WG_EASY_URL must use http:// or https:// (e.g. https://vpn.example.com:51821)'
    );
    process.exit(1);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    // Credentials embedded in the URL would be echoed back on every startup
    // log line and prepended to every request path. They belong in
    // WG_EASY_USERNAME/WG_EASY_PASSWORD, which are wiped from the
    // environment below.
    console.error(
      'wg-easy-mcp: WG_EASY_URL must not contain credentials (user:password@host). ' +
        'Use WG_EASY_USERNAME and WG_EASY_PASSWORD instead.'
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'wg-easy-mcp: WARNING: WG_EASY_URL uses plain http to a non-local host — ' +
        'Basic Auth credentials and WireGuard private keys will be sent unencrypted. Use https:// instead.'
    );
  }

  // The parsed URL, not the environment string. Every path in this server is
  // appended to this value, so a query or a fragment left on the end would be
  // glued in *front* of `/api/client` — a request to a path that does not
  // exist, from a variable that looked right. What was dropped is named and
  // not printed: a query string is where a token would be.
  if (parsed.search !== '' || parsed.hash !== '') {
    console.error(
      'wg-easy-mcp: WG_EASY_URL carries a query or fragment. Only its origin ' +
        'and path are used; the rest is dropped and deliberately not printed ' +
        'here, in case it holds a credential.'
    );
  }

  return {
    url: withoutTrailingSlashes(parsed.origin + parsed.pathname),
    username,
    password,
    insecureTls,
    readOnly,
    elicitation,
    allowTools,
    denyTools,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
