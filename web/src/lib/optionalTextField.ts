/**
 * A native text input's empty value is `""`, never `undefined` — but a
 * zod `z.string().min(1)....optional()` schema only skips its `.min(1)`
 * check for `undefined`, not `""`. Left untouched, an optional field a
 * user never typed into fails validation as "too small" the moment the
 * form submits. Spread into react-hook-form's `register(name, ...)` for
 * any field whose schema is optional.
 */
export const blankToUndefined = {
  setValueAs: (value: unknown): unknown => (value === "" ? undefined : value),
};
