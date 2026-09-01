/**
 * "This string is not a valid wire value" — thrown by the two codecs at the
 * edges, `money.ts`'s `parse()` and `dates.ts`'s `asBusinessDate()`, and by
 * nothing else.
 *
 * It extends `TypeError` so every existing `catch`/`instanceof TypeError`
 * and every test asserting a `TypeError` keeps working unchanged; the point
 * of the subclass is that the Worker's error handler can map *this* to a
 * 400 without mapping every `TypeError` to one.
 *
 * That distinction is the whole reason this file exists (review of PR #170,
 * 31 Aug 2026). `TypeError` is not only what those two codecs throw
 * deliberately — it is also the class the JS engine itself raises for a
 * large family of ordinary bugs that are never written as a `throw`
 * statement and so cannot be found by grepping for one:
 *
 *   - `Cannot read properties of undefined (reading 'x')` — a null deref
 *   - `Cannot mix BigInt and other types, use explicit conversions` — an
 *     arithmetic slip, a live risk in a money layer that is entirely bigint
 *   - `Do not know how to serialize a BigInt` — thrown by `JSON.stringify`
 *     when a handler forgets `toWire`
 *
 * Mapping bare `TypeError` to `ValidationError` turned every one of those
 * into a `400 VALIDATION_ERROR`: logged at `warn` instead of `error`, with
 * the stack dropped (the handler only attaches it at `error`), and the raw
 * internal message handed to the caller. A genuine server bug would have
 * been reported to the client as their own input mistake, in a system whose
 * whole promise is being believed about money.
 */
export class WireFormatError extends TypeError {
  override readonly name = "WireFormatError";
}
