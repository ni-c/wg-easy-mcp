export interface Config {
  /** Base URL of the wg-easy instance, e.g. `http://vpn.example.com:51821` */
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
        'Required: WG_EASY_URL (e.g. http://vpn.example.com:51821), WG_EASY_USERNAME, WG_EASY_PASSWORD\n' +
        'Optional: WG_EASY_INSECURE_TLS=true to accept self-signed certificates'
    );
    process.exit(1);
  }

  return {
    url: url.replace(/\/+$/, ''),
    username,
    password,
    insecureTls: env.WG_EASY_INSECURE_TLS === 'true',
  };
}
