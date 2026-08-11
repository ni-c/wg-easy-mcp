export interface Config {
  /** Base URL of the wg-easy instance, e.g. `https://vpn.example.com:51821` */
  url: string;
  username: string;
  password: string;
  insecureTls: boolean;
}

/**
 * Reads the configuration from environment variables and exits the process
 * with a helpful message if a required variable is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.WG_EASY_URL;
  const username = env.WG_EASY_USERNAME;
  const password = env.WG_EASY_PASSWORD;

  const missing = [
    !url && 'WG_EASY_URL',
    !username && 'WG_EASY_USERNAME',
    !password && 'WG_EASY_PASSWORD',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0 || !url || !username || !password) {
    console.error(
      `wg-easy-mcp: missing required environment variable(s): ${missing.join(', ')}\n` +
        'Required: WG_EASY_URL (e.g. https://vpn.example.com:51821), WG_EASY_USERNAME, WG_EASY_PASSWORD\n' +
        'Optional: WG_EASY_INSECURE_TLS=true to accept self-signed certificates'
    );
    process.exit(1);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`wg-easy-mcp: WG_EASY_URL is not a valid URL: ${url}`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error(
      `wg-easy-mcp: WG_EASY_URL must use http:// or https:// (got ${parsed.protocol})`
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'wg-easy-mcp: WARNING: WG_EASY_URL uses plain http to a non-local host — ' +
        'Basic Auth credentials and WireGuard private keys will be sent unencrypted. Use https:// instead.'
    );
  }

  const config: Config = {
    url: url.replace(/\/+$/, ''),
    username,
    password,
    insecureTls: env.WG_EASY_INSECURE_TLS === 'true',
  };

  // Don't keep the credentials in the environment for the process lifetime
  // (visible to child processes and in /proc/<pid>/environ).
  delete env.WG_EASY_USERNAME;
  delete env.WG_EASY_PASSWORD;

  return config;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('127.') ||
    hostname === '::1'
  );
}
