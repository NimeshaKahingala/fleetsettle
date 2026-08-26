/** DM §9's `expense.category` CHECK, in reserved-vocabulary display form. Shared between `VehicleOverviewScreen`'s costs section and Web-P8b's costs screens so the label set has exactly one copy. */
export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  fuel: "Fuel",
  tolls: "Tolls",
  fines: "Fines",
  cleaning: "Cleaning",
  tyres: "Tyres",
  servicing: "Servicing",
  repairs: "Repairs",
  insurance: "Insurance",
  licence: "Licence",
  crew_food: "Crew food",
  permits: "Permits",
  office: "Office",
  legal: "Legal",
  messaging: "Messaging",
  other: "Other",
  // GAP-185/UC-106: a loan payment's finance portion, generated server-side
  // by domain/vehicle-loan.ts — never entered through RecordExpenseSheet's
  // own category picker. GAP-158/159's own shape: a raw enum reaching the
  // interface unmapped, so this row is required, not a nicety.
  finance: "Interest and charges",
};
