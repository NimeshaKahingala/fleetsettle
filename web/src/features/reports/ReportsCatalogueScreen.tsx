import { ChevronRight } from "lucide-react";
import { Can } from "../../components/Can.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";

export type ReportKey =
  "vehicle-month" | "trips" | "fuel-efficiency" | "receivables" | "cash-position" | "lost-days";

export interface ReportsCatalogueScreenProps {
  onSelect: (key: ReportKey) => void;
}

const CARDS: { key: ReportKey; label: string }[] = [
  { key: "vehicle-month", label: "How was this month" },
  { key: "trips", label: "Which trips made money" },
  { key: "fuel-efficiency", label: "Is the bus drinking fuel" },
  { key: "receivables", label: "Who owes us" },
  { key: "cash-position", label: "Cash partners are holding" },
  { key: "lost-days", label: "Lost days" },
];

/**
 * `/reports` — UI §5.1's catalogue. **Six cards, no owner-only section**:
 * UC-77 and UC-79 are the only two owner-only reports and both are phase 2
 * (B4-REPORTS-DESIGN.md §9.1), so every card here is gated by `viewReports`
 * alone — `viewOwnerOnlyReports` stays built and enforced server-side
 * (B0b/§9.3) with nothing in this list to exercise it yet.
 *
 * Reached from two places rendering the same route (§4's IA table): the
 * Review shell's own `Reports` tab (`owner`), and Operate's `/more` →
 * Reports row (`owner_manager`/`manager`) — this screen doesn't know or
 * care which, since `<Can>` decides visibility from the role alone.
 */
export function ReportsCatalogueScreen({ onSelect }: ReportsCatalogueScreenProps) {
  return (
    <Screen title="Reports">
      <Can cap="viewReports">
        <div className="flex flex-col gap-2">
          {CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => onSelect(card.key)}
              className="w-full text-left"
            >
              <Card className="flex items-center justify-between gap-3">
                <span className="text-body text-ink-primary">{card.label}</span>
                <ChevronRight className="size-4 text-ink-muted" aria-hidden />
              </Card>
            </button>
          ))}
        </div>
      </Can>
    </Screen>
  );
}
