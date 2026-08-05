/** The id a control's `aria-describedby`/`aria-invalid` pairing should use — deterministic, so `Field` and its control agree without threading a ref. */
export function fieldErrorId(htmlFor: string): string {
  return `${htmlFor}-error`;
}
