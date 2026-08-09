import type { CardAccent } from "../design/primitives/Card.js";

export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  repairs_recorded: "Repairs recorded",
  recovery_pending: "Recovery pending",
  closed: "Closed",
};

export const INCIDENT_STATUS_BADGE_VARIANT: Record<string, CardAccent> = {
  open: "warning",
  repairs_recorded: "warning",
  recovery_pending: "warning",
  closed: "good",
};
