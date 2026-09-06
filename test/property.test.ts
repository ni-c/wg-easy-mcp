import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { redactSecrets } from '../src/redact.js';

/**
 * Properties of the redaction filter.
 *
 * Everything wg-easy returns passes through here on its way to the model, and
 * what it carries is key material: the server's WireGuard private key on the
 * admin endpoints, each client's own private and pre-shared key on the client
 * ones, and a one-time link that is a bearer credential — `GET /cnf/<token>`
 * hands back a whole client configuration with no login at all.
 *
 * An example test checks the shapes someone thought of. The API is free to nest
 * differently in the next release, and a secret one level deeper than the test
 * looked would reach the transcript, where it outlives any decision to stop
 * using it. A property says: at *any* depth, under *any* shape.
 */

const RUNS = { numRuns: 500 };

const SECRET_KEYS = [
  'privateKey',
  'preSharedKey',
  'password',
  'passwordHash',
  'sessionSecret',
  'totpSecret',
  'totpKey',
  'oneTimeLink',
];

const CANARY = 'SECRET-VALUE-THAT-MUST-NOT-ESCAPE';

/** An arbitrary JSON structure with a secret buried somewhere inside it. */
const structureHidingASecret = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.record({ [`${'leaf'}`]: fc.constant(CANARY) }),
    fc.dictionary(
      fc.constantFrom(...SECRET_KEYS, 'name', 'id', 'address', 'enabled'),
      tie('node') as fc.Arbitrary<unknown>,
      { maxKeys: 4 }
    ),
    fc.array(tie('node') as fc.Arbitrary<unknown>, { maxLength: 3 })
  ),
})).node;

describe('no secret reaches the far side', () => {
  /**
   * A sensitive key is replaced wherever it sits — at the root, inside an
   * array, or under four levels of object the API invented last release.
   */
  it('a sensitive key is redacted at any depth', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SECRET_KEYS),
        fc.integer({ min: 0, max: 6 }),
        (key, depth) => {
          let value: unknown = { [key]: CANARY };
          for (let i = 0; i < depth; i++) {
            value = i % 2 === 0 ? [value] : { nested: value };
          }
          expect(JSON.stringify(redactSecrets(value))).not.toContain(CANARY);
        }
      ),
      RUNS
    );
  });

  /**
   * The key is matched case-insensitively, because the API has spelled these
   * both ways and a filter that only knew one spelling would be a filter that
   * works until it does not.
   */
  it('the match does not depend on how the key is cased', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SECRET_KEYS),
        fc.boolean(),
        (key, upper) => {
          const spelled = upper ? key.toUpperCase() : key.toLowerCase();
          const redacted = redactSecrets({ [spelled]: CANARY }) as Record<
            string,
            unknown
          >;
          expect(redacted[spelled]).toBe('[redacted]');
        }
      ),
      RUNS
    );
  });

  /** Every key beginning `totp` is a secret, not only the ones listed. */
  it('anything starting with totp is redacted', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z]{0,10}$/), (suffix) => {
        const redacted = redactSecrets({ [`totp${suffix}`]: CANARY }) as Record<
          string,
          unknown
        >;
        expect(redacted[`totp${suffix}`]).toBe('[redacted]');
      }),
      RUNS
    );
  });

  it('a secret buried in an arbitrary structure never survives', () => {
    fc.assert(
      fc.property(structureHidingASecret, (value) => {
        const json = JSON.stringify(redactSecrets(value));
        if (json === undefined) return;
        const carriedUnderSecretKey = JSON.stringify(value)?.match(
          new RegExp(`"(${SECRET_KEYS.join('|')})":"${CANARY}"`, 'i')
        );
        if (carriedUnderSecretKey) expect(json).not.toContain(CANARY);
      }),
      RUNS
    );
  });
});

describe('nothing else is disturbed', () => {
  /**
   * The counterpart. A filter that redacted too much would empty the answer,
   * and the fix for that is to narrow the match — which is how a secret slips
   * back through. Both directions are stated so neither can be traded away.
   */
  it('a structure with no sensitive key comes back unchanged', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom('name', 'id', 'address', 'enabled', 'createdAt'),
          fc.jsonValue(),
          { maxKeys: 5 }
        ),
        (value) => {
          expect(redactSecrets(value)).toEqual(value);
        }
      ),
      RUNS
    );
  });

  /**
   * `oneTimeLink` is a secret only when it *is* the token. As a joined object
   * it still has to say that a link is live and when it lapses — reporting that
   * is useful, carrying the token is not.
   */
  it('a oneTimeLink object keeps its metadata and loses only the token', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (expiresAt) => {
        const redacted = redactSecrets({
          oneTimeLink: { oneTimeLink: CANARY, expiresAt },
        }) as { oneTimeLink: { oneTimeLink: unknown; expiresAt: number } };
        expect(redacted.oneTimeLink.expiresAt).toBe(expiresAt);
        expect(redacted.oneTimeLink.oneTimeLink).toBe('[redacted]');
      }),
      RUNS
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(structureHidingASecret, (value) => {
        const once = redactSecrets(value);
        expect(redactSecrets(once)).toEqual(once);
      }),
      RUNS
    );
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => redactSecrets(value)).not.toThrow();
      }),
      RUNS
    );
  });
});
