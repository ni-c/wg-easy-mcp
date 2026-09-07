/**
 * The boundary between wg-easy's JSON and this server's output schemas.
 *
 * Every tool declares an `outputSchema`, and the SDK validates each answer
 * against it before the answer leaves. That is a promise about *types*: an
 * `id` is a number, a `name` is a string, `transferRx` is a number or null.
 * wg-easy's answer is whatever the instance — or a proxy in front of it, or a
 * typo in `WG_EASY_URL` landing on somebody else's server — chose to send, and
 * a JSON body is read with a TypeScript cast, which checks nothing. One `id`
 * spelled as a string, a `1e999` (which `JSON.parse` turns into `Infinity`, and
 * `z.number()` refuses) or a numeric `name` in one record answered the *whole*
 * listing with `Output validation error`, cause unnamed.
 *
 * So each field the schema types is read here with a check of that exact type,
 * and a value of the wrong type is left out rather than passed on. Fields the
 * schema does not type are passed through untouched: the record is loose on
 * purpose, so a release that adds a field cannot break a listing.
 */

/** `value` as a record of its own enumerable properties, `{}` otherwise. */
export function objectOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  // `Object.fromEntries` rather than the object itself: a `__proto__` key,
  // which is legal JSON, is an own property after `JSON.parse` and stays one
  // here, and the prototype of what leaves is always `Object.prototype`.
  return Object.fromEntries(Object.entries(value));
}

/** `value` when it is an array, `[]` otherwise. */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `value` when it is a string, else `undefined`. */
export function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `value` when it is a finite number, else `undefined`.
 *
 * `+ 0` turns `-0` into `0`: `JSON.stringify(-0)` is `0`, so the text block
 * and `structuredContent` would otherwise disagree about the same value.
 */
export function finiteNumberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value + 0
    : undefined;
}

/** `value` when it is a string or `null`, else `undefined`. */
function nullableStringOf(value: unknown): string | null | undefined {
  return value === null ? null : stringOf(value);
}

/** `value` when it is a finite number or `null`, else `undefined`. */
function nullableNumberOf(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumberOf(value);
}

/** The string entries of `value` when it is an array, else `undefined`. */
function stringArrayOf(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

function nullableStringArrayOf(value: unknown): string[] | null | undefined {
  return value === null ? null : stringArrayOf(value);
}

/**
 * The `oneTimeLink` slot: a joined row on wg-easy 15, a bare string on older
 * builds, `null` when there is no link.
 */
function oneTimeLinkOf(
  value: unknown
): Record<string, unknown> | string | null | undefined {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return objectOf(value);
  }
  return undefined;
}

/**
 * The control characters that are removed from anything the instance wrote.
 *
 * The same class the rest of this family uses: C0 and C1 controls, DEL, and the
 * BiDi override and isolate characters — a right-to-left override in a client
 * name reorders the line around it in whatever renders the transcript, which is
 * the same trick as an escape sequence by another route.
 *
 * Tab, newline and carriage return are kept: they are formatting a client name
 * or a DNS list may legitimately carry, and removing them changes the value
 * rather than defusing it. What is removed is the rest — an ESC that starts a
 * terminal escape sequence in whatever renders the transcript, a NUL that
 * truncates a C string, the C1 range.
 */
const CONTROL_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- matching them is the point
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** True when `text` carries a character {@link cleanText} would remove. */
export function hasControlCharacters(text: string): boolean {
  CONTROL_CHARACTERS.lastIndex = 0;
  return CONTROL_CHARACTERS.test(text);
}

/** `text` without the control characters above. */
export function cleanText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '');
}

/**
 * Everything the instance sent, made safe to carry in both channels.
 *
 * Three things, because all three are the same problem — a value that is legal
 * JSON and cannot survive the trip:
 *
 *  - **Strings are cleaned, keys included.** A client name is free text somebody
 *    typed into the wg-easy UI, and so is a DNS entry and a `serverEndpoint`.
 *    wg-easy stores what it is given. A key is the instance's too: this record
 *    is passed through loosely on purpose, so a field wg-easy adds tomorrow
 *    arrives here named by whoever wrote it.
 *  - **Non-finite numbers become `null`.** `1e999` in a body is `Infinity` after
 *    `JSON.parse`, `JSON.stringify` writes it as `null`, and
 *    `structuredContent` would carry the number — so the two channels would
 *    disagree about the same field. `+ 0` for the same reason on `-0`.
 *  - **A `__proto__` key is dropped.** It is legal JSON and an own property
 *    after `JSON.parse`, and almost nothing downstream carries it faithfully:
 *    an ordinary assignment sets a prototype instead of a field, and the
 *    schema check on the far side drops it from `structuredContent` while the
 *    text block keeps it — which is the two channels disagreeing again. There
 *    is no field wg-easy means by that name, so it goes.
 */
function clean(value: unknown, jsonNumbers: boolean): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number') {
    if (!jsonNumbers) return value;
    return Number.isFinite(value) ? value + 0 : null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clean(entry, jsonNumbers));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]): [string, unknown] => [
          cleanText(key),
          clean(entry, jsonNumbers),
        ])
        .filter(([key]) => key !== '__proto__')
    );
  }
  return value;
}

/** {@link clean} for a value nothing else will type-check: numbers included. */
function cleanDeep(value: unknown): unknown {
  return clean(value, true);
}

/**
 * {@link clean} for a value a typed reader is about to check: numbers left
 * exactly as they arrived.
 *
 * The difference matters in one place and it is not cosmetic. `transferRx` is
 * typed "a number, or `null` before the first handshake". Turning a `1e999`
 * into `null` here would satisfy the schema and *assert something false* — that
 * this peer has never connected. The reader has to see the `Infinity` so it can
 * leave the field out, which is what "we did not get a usable value" looks like
 * in a record where every field is optional.
 */
function cleanStrings(value: unknown): unknown {
  return clean(value, false);
}

/** {@link cleanDeep} as a record, for a payload that has to be one. */
export function cleanRecord(value: unknown): Record<string, unknown> {
  return objectOf(cleanDeep(value));
}

/**
 * A body that has to be a string, as one — or an error naming what came
 * instead.
 *
 * `String(value)` is what this replaces, and on an object it answers
 * `[object Object]`: a `.conf` file whose contents are the words "object
 * Object", handed over as a WireGuard configuration. wg-easy answers these two
 * endpoints with a file, but an error page, a JSON `{message: …}` from a proxy
 * or a redirect body are all reachable, and a caller has to be able to tell a
 * configuration from the absence of one.
 */
export function stringBody(value: unknown, what: string): string {
  if (typeof value === 'string') return value;
  throw new Error(
    `The wg-easy instance answered ${kindOf(value)} where ${what} was ` +
      'expected. Nothing usable was returned; check the instance and the ' +
      'client id.'
  );
}

type Reader = (value: unknown) => unknown;

/**
 * One reader per field `clientRecord` types. A field absent from this table is
 * passed through as it came; a field in it is kept only when the reader
 * accepts it.
 */
const CLIENT_FIELDS: ReadonlyMap<string, Reader> = new Map<string, Reader>([
  ['id', finiteNumberOf],
  ['name', stringOf],
  ['enabled', (value) => (typeof value === 'boolean' ? value : undefined)],
  ['expiresAt', nullableStringOf],
  ['ipv4Address', stringOf],
  ['ipv6Address', stringOf],
  ['publicKey', stringOf],
  ['privateKey', stringOf],
  ['preSharedKey', stringOf],
  ['allowedIps', nullableStringArrayOf],
  ['serverAllowedIps', stringArrayOf],
  ['dns', nullableStringArrayOf],
  ['mtu', finiteNumberOf],
  ['persistentKeepalive', finiteNumberOf],
  ['serverEndpoint', nullableStringOf],
  ['createdAt', stringOf],
  ['updatedAt', stringOf],
  ['latestHandshakeAt', nullableStringOf],
  ['transferRx', nullableNumberOf],
  ['transferTx', nullableNumberOf],
  ['oneTimeLink', oneTimeLinkOf],
]);

/**
 * A client record as `clientRecord` in `output-schema.ts` promises it: every
 * typed field either has that type or is absent.
 *
 * Applied after `redactSecrets`, so a redacted key holds the string
 * `[redacted]` and passes as one.
 *
 * Every string is cleaned first, keys included, and then the typed fields are
 * read: cleaning cannot turn an accepted value into a rejected one, and the
 * fields that are *not* typed here — the loose remainder — get the same
 * treatment, which is the point. A client name is what somebody typed.
 */
export function shapeClient(value: unknown): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const [rawKey, rawEntry] of Object.entries(objectOf(value))) {
    const key = cleanText(rawKey);
    if (key === '__proto__') continue;
    const read = CLIENT_FIELDS.get(key);
    if (read === undefined) {
      // Untyped, so nothing downstream will check it: it is made to survive
      // `JSON.stringify` here instead, or the two channels disagree.
      entries.push([key, cleanDeep(rawEntry)]);
      continue;
    }
    const accepted = read(cleanStrings(rawEntry));
    if (accepted !== undefined) entries.push([key, accepted]);
  }
  return Object.fromEntries(entries);
}

/**
 * The client records in a list answer, and how many entries were not one.
 *
 * An entry that is not an object cannot be a client and would fail the
 * listing's schema on its own; it is left out and counted, never dropped in
 * silence.
 */
export function shapeClientList(value: unknown): {
  clients: Record<string, unknown>[];
  skipped: number;
} {
  const entries = arrayOf(value);
  const clients = entries
    .filter(
      (entry) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    )
    .map(shapeClient);
  return { clients, skipped: entries.length - clients.length };
}

/** A one-word name for what `value` is, for a sentence about a wrong shape. */
export function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return 'a string';
  return `a ${typeof value}`;
}
