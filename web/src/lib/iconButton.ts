import { rowButtonFocus } from "./rowButtonFocus.js";

/**
 * The 44×44 icon-only `<button>` the shell chrome is built from — `Screen`'s
 * back and action buttons, `Sheet`'s and `Dialog`'s close, `Toast`'s dismiss.
 *
 * It existed as the same class string copied byte-for-byte into four files,
 * which is exactly how all five ended up with `active:bg-brand-wash` for
 * touch and nothing at all for a keyboard user: the focus ring was never
 * omitted deliberately, it just never made it into the copy. Shared here so
 * the next icon button cannot repeat that, and so `rowButtonFocus`'s ring —
 * already the app's one focus treatment for hand-rolled buttons — reaches
 * the chrome too (WCAG 2.4.7; `ring-inset` keeps it clear of an app bar's
 * edge rather than clipping against it).
 */
export const iconButton = `flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash ${rowButtonFocus}`;
