import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarRange,
  ChevronRight,
  Download,
  Fuel,
  Gift,
  History,
  Hourglass,
  PiggyBank,
  ReceiptText,
  Route,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { Can } from "../../components/Can.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { can } from "../../lib/capabilities.js";
import { resolveSelectedMembership } from "../../lib/selectedMembership.js";

export type ReportKey =
  | "vehicle-month"
  | "vehicle-year"
  | "trips"
  | "fuel-efficiency"
  | "receivables"
  | "cash-position"
  | "distributable-cash"
  | "lost-days"
  | "ageing"
  | "goodwill"
  | "utilisation"
  | "export";

export interface ReportsCatalogueScreenProps {
  onSelect: (key: ReportKey) => void;
  onBack?: () => void;
}

/** GAP-98: `true` restricts a card to `viewOwnerOnlyReports` (UC-77/UC-79) — everything else needs only `viewReports`, the same gate the whole screen already sits behind. */
const GROUPS: {
  title: string;
  cards: { key: ReportKey; label: string; icon: LucideIcon; ownerOnly?: true }[];
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
      {
        key: "utilisation",
        label: "How hard is each vehicle working",
        icon: Hourglass,
        ownerOnly: true,
      },
      { key: "vehicle-year", label: "How was the year", icon: CalendarRange, ownerOnly: true },
    ],
  },
  {
    title: "Money questions",
    cards: [
      { key: "receivables", label: "Who owes us", icon: ReceiptText },
      { key: "ageing", label: "Who is overdue, and by how long", icon: History },
      { key: "cash-position", label: "Where is our cash", icon: Banknote },
      { key: "distributable-cash", label: "What can we safely take out", icon: PiggyBank },
      { key: "goodwill", label: "Goodwill given", icon: Gift, ownerOnly: true },
      {
        key: "export",
        label: "Export transactions (CSV)",
        icon: Download,
        ownerOnly: true,
      },
    ],
  },
];

/**
 * `/reports` — UI §5.1's catalogue. **Twelve cards now, not six** (GAP-98,
 * GAP-18 adding UC-73's yearly view and UC-99's CSV export, GAP-186 adding
 * UC-109's distributable cash):
 * UC-77 (goodwill) and UC-79 (utilisation) were the only two owner-only
 * reports and both were phase 2 — both moved to phase 1 with UC-78
 * (ageing) on 11 Aug 2026 (`use-cases.md` v1.2.5), and this catalogue is
 * what was still deliberately holding all three back. Owner-only cards are
 * filtered here, by role, before render — never rendered then hidden by
 * `<Can>`, which would leave "Trips and vehicles"/"Money questions" reading
 * as one card short with no explanation for a manager.
 *
 * Reached from two places rendering the same route (§4's IA table): the
 * Review shell's own `Reports` tab (`owner`), and Operate's `/more` →
 * Reports row (`owner_manager`/`manager`) — this screen doesn't know or
 * care which, since `<Can>`/`can()` decide visibility from the role alone.
 */
export function ReportsCatalogueScreen({ onSelect, onBack }: ReportsCatalogueScreenProps) {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  // Phase 3: the selected membership's role, not businesses[0] unconditionally
  // — see Can.tsx's identical note.
  const role = session !== undefined ? resolveSelectedMembership(session)?.role : undefined;
  const canSeeOwnerOnly = role !== undefined && can(role, "viewOwnerOnlyReports");

  return (
    <Screen title="Reports" {...(onBack !== undefined ? { onBack } : {})}>
      <Can cap="viewReports">
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => {
            const cards = group.cards.filter((card) => canSeeOwnerOnly || card.ownerOnly !== true);
            if (cards.length === 0) return null;
            return (
              <Section
                key={group.title}
                title={group.title}
                count={cards.length}
                items={cards.map((card) => {
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
            );
          })}
        </div>
      </Can>
    </Screen>
  );
}
