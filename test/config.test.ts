import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    WG_EASY_URL: 'https://vpn.example.com:51821',
    WG_EASY_USERNAME: 'admin',
    WG_EASY_PASSWORD: 'secret',
    ...overrides,
  };
}

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ELICITATION', () => {
  it('defaults to on, and to on for an empty value', () => {
    // The only variable of this family that defaults to *on*. An unset switch
    // has to mean "ask", or a deployment that never heard of it would quietly
    // stop asking.
    expect(loadConfig(env()).elicitation).toBe(true);
    expect(loadConfig(env({ ELICITATION: '' })).elicitation).toBe(true);
  });

  it('is switched off by "false", in any casing or padding', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      expect(loadConfig(env({ ELICITATION: raw })).elicitation, raw).toBe(
        false
      );
    }
  });

  it('refuses to start on anything else, naming both valid values', () => {
    // Deliberately fatal rather than falling back to the default: a typo would
    // leave the dialog running while the operator believes it is off, and
    // nothing else would ever tell them.
    for (const raw of ['1', 'off', 'no']) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      expect(() => loadConfig(env({ ELICITATION: raw }))).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0] ?? '');
      expect(message, raw).toContain('ELICITATION');
      expect(message, raw).toContain('"true"');
      expect(message, raw).toContain('"false"');
      vi.restoreAllMocks();
    }
  });

  it('has already wiped the credential by the time it can exit', () => {
    // parseElicitation sits *after* the delete on purpose. An exit above it
    // would leave the credential in the environment for whatever a crash
    // reporter or an inspector does next — which is exactly what that delete
    // exists to prevent, and its comment says so.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({ ELICITATION: 'nonsense' });
    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.WG_EASY_PASSWORD).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('loadConfig', () => {
  it('returns the config and strips trailing slashes from the URL', () => {
    const config = loadConfig(env({ WG_EASY_URL: 'https://wg.example.com/' }));
    expect(config).toEqual({
      url: 'https://wg.example.com',
      username: 'admin',
      password: 'secret',
      insecureTls: false,
      readOnly: false,
      elicitation: true,
      allowTools: undefined,
      denyTools: undefined,
    });
  });

  it('parses WG_EASY_INSECURE_TLS=true', () => {
    const config = loadConfig(env({ WG_EASY_INSECURE_TLS: 'true' }));
    expect(config.insecureTls).toBe(true);
  });

  it('removes the credentials from the environment after loading', () => {
    const environment = env();
    loadConfig(environment);
    expect(environment.WG_EASY_USERNAME).toBeUndefined();
    expect(environment.WG_EASY_PASSWORD).toBeUndefined();
  });

  it('removes the credentials even when the URL is missing', () => {
    // Regression: with the deletion at the end of loadConfig, the early return
    // for a missing URL skipped it, so username and password stayed in
    // process.env for the whole process lifetime — readable in
    // /proc/<pid>/environ and inherited by every child process. A missing URL
    // with credentials present is a plausible misconfiguration, and it is
    // exactly the state in which someone reaches for an inspector.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const environment: NodeJS.ProcessEnv = {
      WG_EASY_USERNAME: 'admin',
      WG_EASY_PASSWORD: 'secret',
    };
    const config = loadConfig(environment);
    expect(environment.WG_EASY_USERNAME).toBeUndefined();
    expect(environment.WG_EASY_PASSWORD).toBeUndefined();
    // Still handed to the caller — the server starts, it just cannot call out.
    expect(config.username).toBe('admin');
    expect(config.password).toBe('secret');
    expect(config.url).toBeUndefined();
  });

  it('warns but does not exit when required variables are missing', () => {
    // Registries and inspectors start the server without credentials and
    // expect the MCP handshake to succeed.
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = loadConfig({});

    expect(config).toEqual({
      url: undefined,
      username: undefined,
      password: undefined,
      insecureTls: false,
      readOnly: false,
      elicitation: true,
      allowTools: undefined,
      denyTools: undefined,
    });
    expect(exit).not.toHaveBeenCalled();
    expect(error.mock.calls[0]?.[0]).toContain(
      'WG_EASY_URL, WG_EASY_USERNAME, WG_EASY_PASSWORD'
    );
  });

  it('exits on an invalid URL', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => loadConfig(env({ WG_EASY_URL: 'not a url' }))).toThrow(
      'process.exit'
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not echo the offending value of an invalid URL', () => {
    // Regression: this branch fires precisely when the variable does not hold a
    // URL — most often because a password was pasted into the wrong one. The
    // message used to quote the value, putting it in the MCP host's log.
    mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ WG_EASY_URL: 'wg_password_in_the_wrong_variable' }))
    ).toThrow('process.exit');
    const output = error.mock.calls.flat().join(' ');
    expect(output).toMatch(/is not a valid URL/);
    expect(output).not.toContain('wg_password_in_the_wrong_variable');
  });

  it('exits on a non-http(s) URL scheme', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ WG_EASY_URL: 'ftp://wg.example.com' }))
    ).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits when the URL embeds credentials', () => {
    // user:password@host would be echoed in the startup log and prefixed to
    // every request path, bypassing the env-wipe above.
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(
        env({ WG_EASY_URL: 'https://admin:hunter2@vpn.example.com:51821' })
      )
    ).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls.at(-1)?.[0])).not.toContain('hunter2');
  });

  it('exits when the URL embeds a username only', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ WG_EASY_URL: 'https://admin@vpn.example.com:51821' }))
    ).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('warns on plain http to a non-local host', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({ WG_EASY_URL: 'http://wg.example.com:51821' }));
    expect(String(error.mock.calls[0]?.[0])).toContain('unencrypted');
  });

  it('does not warn on plain http to localhost', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({ WG_EASY_URL: 'http://localhost:51821' }));
    loadConfig(env({ WG_EASY_URL: 'http://127.0.0.1:51821' }));
    // Regression: URL.hostname returns "[::1]" with the brackets, so comparing
    // against a bare "::1" never matched and this warned about a loopback URL.
    loadConfig(env({ WG_EASY_URL: 'http://[::1]:51821' }));
    expect(error).not.toHaveBeenCalled();
  });
});
