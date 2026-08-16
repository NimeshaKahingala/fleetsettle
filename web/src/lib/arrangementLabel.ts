import type { CardAccent } from "../design/primitives/Card.js";

/**
 * Shared rather than copied — `VehicleListScreen` and `VehicleOverviewScreen`
 * both showed a vehicle's arrangement and had each grown their own copy of
 * this map, the same drift GAP-81 already found and fixed once for
 * `EXPENSE_CATEGORY_LABEL`.
 */
export const ARRANGEMENT_LABEL: Record<string, string> = {
  A: "Lease out",
  B: "Daily lease",
  C: "Trips / charter",
};

/**
 * Doubles as a `Badge` variant and a `Card` accent — same word, same colour,
 * both places it appears. **C uses its own `trip` token (GAP-27), not
 * `serious`** — a vehicle on a trip isn't overdue or in arrears, and reusing
 * the status token was a colour match, not a semantic one.
 */
export const ARRANGEMENT_BADGE_VARIANT: Record<string, CardAccent> = {
  A: "brand",
  B: "good",
  C: "trip",
};
