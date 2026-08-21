/**
 * WCAG 2.4.7/2.2 Focus Appearance for every hand-rolled list-row `<button>`
 * in the app (no shared `ListRow` primitive exists to fix this centrally) —
 * `active:bg-brand-wash` gives touch feedback but nothing for a keyboard
 * user tabbing through. `ring-inset` keeps the ring inside the row so
 * adjacent rows don't clip it.
 */
export const rowButtonFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset";
