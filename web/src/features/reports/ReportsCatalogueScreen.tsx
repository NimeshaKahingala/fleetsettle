import {
  Banknote,
  CalendarRange,
  ChevronRight,
  Fuel,
  ReceiptText,
  Route,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { Can } from "../../components/Can.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";

export type ReportKey =
  "vehicle-month" | "trips" | "fuel-efficiency" | "receivables" | "cash-position" | "lost-days";

export interface ReportsCatalogueScreenProps {
  onSelect: (key: ReportKey) => void;
}

const GROUPS: {
  title: string;
  cards: { key: ReportKey; label: string; icon: LucideIcon }[];
}[] = [
  {
    title: "This month",
    cards: [
      { key: "vehicle-month", label: "How was this month", icon: CalendarRange },
      { key: "lost-days", label: "Lost days", icon: TimerOff },
    ],
  },
  {
    title: "Trips and vehicles",
    cards: [
      { key: "trips", label: "Which trips made money", icon: Route },
      { key: "fuel-efficiency", label: "Is the bus drinking fuel", icon: Fuel },
    ],
  },
  {
    title: "Money questions",
    cards: [
      { key: "receivables", label: "Who owes us", icon: ReceiptText },
      { key: "cash-position", label: "Where is our cash", icon: Banknote },
    ],
  },
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
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <Section
              key={group.title}
              title={group.title}
              count={group.cards.length}
              items={group.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => onSelect(card.key)}
                    className="w-full text-left"
                  >
                    <Card className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <Icon className="size-5 shrink-0 text-ink-secondary" aria-hidden />
                        <span className="min-w-0 text-body text-ink-primary">{card.label}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    </Card>
                  </button>
                );
              })}
            />
          ))}
        </div>
      </Can>
    </Screen>
  );
}
