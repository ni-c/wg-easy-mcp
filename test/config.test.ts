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

describe('loadConfig', () => {
  it('returns the config and strips trailing slashes from the URL', () => {
    const config = loadConfig(env({ WG_EASY_URL: 'https://wg.example.com/' }));
    expect(config).toEqual({
      url: 'https://wg.example.com',
      username: 'admin',
      password: 'secret',
      insecureTls: false,
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

  it('exits when required variables are missing', () => {
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => loadConfig({})).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
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

  it('exits on a non-http(s) URL scheme', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ WG_EASY_URL: 'ftp://wg.example.com' }))
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
    expect(error).not.toHaveBeenCalled();
  });
});
