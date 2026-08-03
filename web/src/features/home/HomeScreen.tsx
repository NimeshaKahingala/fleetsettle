import {
  asBusinessDate,
  businessToday,
  parse,
  type BusinessDate,
  type Minor,
} from "@fleetsettle/shared";
import type {
  ActiveDailyLeaseRow,
  DepositReleaseRow,
  InProgressTripRow,
  PaperworkWarningRow,
  ReceivableRow,
  UnconfirmedDayRecordRow,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { AlertStrip } from "../../components/AlertStrip.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Money } from "../../components/Money.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { ConfirmDayCard } from "../daily/ConfirmDayCard.js";

export interface HomeScreenProps {
  onSelectVehicle: (vehicleId: string) => void;
}

function formatHomeDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function paperworkMessage(row: PaperworkWarningRow): string {
  const doc = row.docType === "revenue_licence" ? "revenue licence" : row.docType;
  const verb = row.isExpired ? "expired" : "expires";
  return `${row.subjectLabel} — ${doc} ${verb} ${row.expiryDate}`;
}

/**
 * §3.2's 1 / 2–3 / 4+ collapse. "Most-recently-used elevated" (2–3 case)
 * degrades to "first in a stable order elevated": nothing in this schema
 * tracks last-used-at yet (queries/dailyLease.ts's own comment on the
 * ordering it does have — registration, not recency). At 4+, the summary
 * row states vehicle count and total expected rather than the wireframe's
 * illustrative "N to confirm" — knowing how many of those are *already*
 * confirmed today would need each one's own day-record fetch, the same
 * bulk-status endpoint gap recorded for F-4.6 (bulk week-confirm).
 */
function TodayCards({ leases, today }: { leases: ActiveDailyLeaseRow[]; today: BusinessDate }) {
  const [expanded, setExpanded] = useState(false);

  const cards = leases.map((lease, index) => (
    <ConfirmDayCard
      key={lease.id}
      dailyLeaseId={lease.id}
      vehicleLabel={lease.vehicleRegistration}
      driverLabel={lease.driverName}
      dateLabel={formatHomeDate(today)}
      today={today}
      elevated={index === 0}
    />
  ));

  if (leases.length <= 3 || expanded) {
    return <div className="flex flex-col gap-3">{cards}</div>;
  }

  const totalExpected = leases.reduce(
    (sum, lease) => sum + parse(lease.dailyLeaseAmountMinor),
    0n,
  ) as Minor;

  return (
    <button type="button" className="w-full text-left" onClick={() => setExpanded(true)}>
      <Card className="flex items-center justify-between gap-4">
        <p className="text-title text-ink-primary">{leases.length} vehicles running today</p>
        <Money value={totalExpected} />
      </Card>
    </button>
  );
}

/**
 * §3.2's ordered stack, assembled from six independent reads — each section
 * renders the instant its own query resolves, never blocked on the
 * slowest one (item 3, the elevated card, is the most latency-sensitive
 * per U-1's "30-second day" and must not wait behind item 7). Item 1
 * (failed messages) stays absent: P14 is blocked and has no read endpoint.
 *
 * §7.1: "the home screen shows the empty state until the first response
 * lands" — no skeleton is built here. The escalation to a skeleton only
 * fires when the app *already knows* (from a warm cache) that a vehicle
 * exists, and there's no persistence yet to make a cold cache warm
 * (Web-P11) — so every cold load correctly renders the empty state first
 * and gets silently replaced the instant real data arrives, exactly as
 * specified, not as a shortcut.
 */
export function HomeScreen({ onSelectVehicle }: HomeScreenProps) {
  const api = useApi();
  const today = businessToday();

  const paperworkQuery = useQuery({
    queryKey: ["home", "paperwork-warnings"],
    queryFn: () => api.get<PaperworkWarningRow[]>("/api/home/paperwork-warnings"),
  });
  const activeLeasesQuery = useQuery({
    queryKey: ["daily-lease", "active"],
    queryFn: () => api.get<ActiveDailyLeaseRow[]>("/api/daily-lease"),
  });
  const unconfirmedQuery = useQuery({
    queryKey: ["day-record", "unconfirmed"],
    queryFn: () => api.get<UnconfirmedDayRecordRow[]>("/api/day-record"),
  });
  const receivablesQuery = useQuery({
    queryKey: ["reports", "receivables"],
    queryFn: () => api.get<ReceivableRow[]>("/api/reports/receivables"),
  });
  const depositReleasesQuery = useQuery({
    queryKey: ["home", "deposit-releases"],
    queryFn: () => api.get<DepositReleaseRow[]>("/api/home/deposit-releases"),
  });
  const tripsQuery = useQuery({
    queryKey: ["trip", "in-progress"],
    queryFn: () => api.get<InProgressTripRow[]>("/api/trip"),
  });

  const paperworkWarnings = paperworkQuery.data ?? [];
  const activeLeases = activeLeasesQuery.data ?? [];
  const unconfirmedDays = unconfirmedQuery.data ?? [];
  // F-2.2's own territory is customer rent; the same receivables report also
  // carries driver arrears, which surface on the driver's own two-balance
  // screen (Web-P4), never duplicated here.
  const rentDue = (receivablesQuery.data ?? []).filter((row) => row.partyType === "customer");
  const depositReleases = depositReleasesQuery.data ?? [];
  const inProgressTrips = tripsQuery.data ?? [];

  const anySectionHasContent =
    paperworkWarnings.length > 0 ||
    activeLeases.length > 0 ||
    unconfirmedDays.length > 0 ||
    rentDue.length > 0 ||
    depositReleases.length > 0 ||
    inProgressTrips.length > 0;

  return (
    <Screen title="Home">
      <div className="flex flex-col gap-4">
        {!anySectionHasContent ? <EmptyState message="Nothing needs you today" /> : null}

        {paperworkWarnings.map((row) => (
          <AlertStrip
            key={`${row.subjectType}-${row.subjectId}-${row.docType}`}
            severity={row.isExpired ? "critical" : "warning"}
            icon={TriangleAlert}
            {...(row.subjectType === "vehicle"
              ? {
                  action: {
                    label: "View vehicle",
                    onClick: () => onSelectVehicle(row.subjectId),
                  },
                }
              : {})}
          >
            {paperworkMessage(row)}
          </AlertStrip>
        ))}

        {activeLeases.length > 0 ? <TodayCards leases={activeLeases} today={today} /> : null}

        {/* Reuses ConfirmDayCard verbatim for a past date: it derives its
            displayed "expected" amount from the daily lease's CURRENT rate,
            not the rate in force on that specific day (F-4.3's own
            effective-dated rates aren't built yet, so no daily lease can
            actually have more than one rate today — this is unreachable
            until F-4.3 lands, at which point ConfirmDayCard needs a
            date-aware rate lookup for this call site specifically). The
            backend write itself is already date-correct regardless
            (handlers/day-record.ts uses findDailyLeaseRateForDate). */}
        {unconfirmedDays.length > 0 ? (
          <Section
            title="Earlier days"
            count={unconfirmedDays.length}
            items={unconfirmedDays.map((row) => (
              <ConfirmDayCard
                key={row.id}
                dailyLeaseId={row.dailyLeaseId}
                vehicleLabel={row.vehicleRegistration}
                driverLabel={row.driverName}
                dateLabel={formatHomeDate(row.businessDate)}
                today={asBusinessDate(row.businessDate)}
                elevated={false}
              />
            ))}
          />
        ) : null}

        {rentDue.length > 0 ? (
          <Section
            title="Rent due"
            count={rentDue.length}
            items={rentDue.map((row) => (
              <Card key={row.partyId} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-title text-ink-primary">{row.partyName ?? "—"}</p>
                  <p className="text-body-sm text-ink-muted">Due since {row.oldestDueOn}</p>
                </div>
                <Money value={parse(row.outstandingMinor)} />
              </Card>
            ))}
          />
        ) : null}

        {depositReleases.length > 0 ? (
          <Section
            title="Deposits to release"
            count={depositReleases.length}
            items={depositReleases.map((row) => (
              <Card key={row.depositId} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-title text-ink-primary">{row.partyName ?? "—"}</p>
                  <p className="text-body-sm text-ink-muted">Held since {row.holdReleaseDate}</p>
                </div>
                <Money value={parse(row.heldMinor)} />
              </Card>
            ))}
          />
        ) : null}

        {inProgressTrips.length > 0 ? (
          <Section
            title="Trips in progress"
            count={inProgressTrips.length}
            items={inProgressTrips.map((row) => (
              <Card key={row.id} className="flex flex-col gap-1">
                <p className="text-title text-ink-primary">{row.vehicleRegistration}</p>
                <p className="text-body-sm text-ink-muted">
                  {row.destination ?? "No destination recorded"} · {row.startDate}–{row.endDate}
                </p>
              </Card>
            ))}
          />
        ) : null}
      </div>
    </Screen>
  );
}
