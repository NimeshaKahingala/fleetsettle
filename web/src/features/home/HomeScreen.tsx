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
import {
  Banknote,
  CalendarCheck,
  HandCoins,
  Route,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { AlertStrip } from "../../components/AlertStrip.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ConfirmDayCard } from "../daily/ConfirmDayCard.js";
import { ConfirmWeekGroupCard } from "../daily/ConfirmWeekGroupCard.js";

export interface HomeScreenProps {
  onSelectVehicle: (vehicleId: string) => void;
  /** Web-P7: item 7's own trips now have somewhere to go — `TripDetailScreen`. */
  onSelectTrip: (tripId: string) => void;
}

function formatHomeDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * GAP-138 (19 Aug 2026 live QA pass, F-1): a rent-due row's `oldestDueOn`
 * can be in the future — F-4/§7's "Rent due and overdue" deliberately lists
 * both — so "Due since" alone asserted a date that hadn't happened yet.
 * `BusinessDate` strings compare lexicographically (`YYYY-MM-DD`), the same
 * assumption `lease-closure.ts`'s own date comparisons already rely on.
 */
function dueLabel(oldestDueOn: string, today: BusinessDate): string {
  return oldestDueOn <= today
    ? `Due since ${formatShortDate(oldestDueOn)}`
    : `Due on ${formatShortDate(oldestDueOn)}`;
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatShortDate(startDate);
  const end = formatShortDate(endDate);
  return start === end ? start : `${start}–${end}`;
}

interface UnconfirmedGroup {
  dailyLeaseId: string;
  vehicleRegistration: string;
  driverName: string;
  /** Oldest first, inherited from the source list's own ordering. */
  days: UnconfirmedDayRecordRow[];
}

/**
 * F-4.6/GAP-2: groups the flat, business-wide oldest-first list by lease so
 * a driver with several days waiting gets one `ConfirmWeekGroupCard`
 * instead of one `ConfirmDayCard` each. A `Map`'s insertion order is a
 * lease's own first appearance in the (already oldest-first) source array,
 * so the groups themselves come out oldest-first too, with no separate sort.
 */
function groupUnconfirmedByLease(rows: UnconfirmedDayRecordRow[]): UnconfirmedGroup[] {
  const groups = new Map<string, UnconfirmedGroup>();
  for (const row of rows) {
    const existing = groups.get(row.dailyLeaseId);
    if (existing) {
      existing.days.push(row);
    } else {
      groups.set(row.dailyLeaseId, {
        dailyLeaseId: row.dailyLeaseId,
        vehicleRegistration: row.vehicleRegistration,
        driverName: row.driverName,
        days: [row],
      });
    }
  }
  return [...groups.values()];
}

function paperworkMessage(row: PaperworkWarningRow): string {
  const doc = row.docType === "revenue_licence" ? "revenue licence" : row.docType;
  const verb = row.isExpired ? "expired" : "expires";
  return `${row.subjectLabel} — ${doc} ${verb} ${formatShortDate(row.expiryDate)}`;
}

function paperworkTitle(row: PaperworkWarningRow): string {
  return row.isExpired ? "Paperwork expired" : "Paperwork expires soon";
}

function sumMinor<T>(rows: T[], amount: (row: T) => string): Minor {
  return rows.reduce((sum, row) => sum + parse(amount(row)), 0n) as Minor;
}

function HomeSummaryItem({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: LucideIcon;
  tone?: "brand" | "warning" | "critical" | "good";
}) {
  const iconTone =
    tone === "critical"
      ? "text-critical-ink"
      : tone === "warning"
        ? "text-warning-ink"
        : tone === "good"
          ? "text-good-ink"
          : "text-brand-ink";

  return (
    <div className="flex min-w-28 flex-1 flex-col gap-1 px-3 py-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`size-4 shrink-0 ${iconTone}`} aria-hidden />
        <p className="min-w-0 truncate text-caption font-medium text-ink-secondary sm:text-label">
          {label}
        </p>
      </div>
      <div className="truncate text-body font-medium text-ink-primary sm:text-title">{value}</div>
      <p className="hidden text-caption text-ink-muted sm:block">{detail}</p>
    </div>
  );
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
 * M-28/GAP-126: the empty state is a real answer, not the loading fallback.
 * A cold start can have all six lists still unresolved, which is not the
 * same thing as no work; only render "Nothing needs you today" after every
 * Home read has answered successfully and all six lists are genuinely empty.
 */
export function HomeScreen({ onSelectVehicle, onSelectTrip }: HomeScreenProps) {
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

  // GAP-101/M-28: each section still renders the instant its own read
  // resolves, unblocked by the others (this screen's own doc comment,
  // above) — but a *failed* read must not be indistinguishable from one
  // still pending. `?? []` alone can't tell "nothing yet" from "never
  // coming", which is exactly how this screen used to render "Nothing
  // needs you today" while the Worker was down and rent was overdue.
  const paperworkState = useQueryState(paperworkQuery);
  const activeLeasesState = useQueryState(activeLeasesQuery);
  const unconfirmedState = useQueryState(unconfirmedQuery);
  const receivablesState = useQueryState(receivablesQuery);
  const depositReleasesState = useQueryState(depositReleasesQuery);
  const tripsState = useQueryState(tripsQuery);

  const paperworkWarnings = paperworkQuery.data ?? [];
  const activeLeases = activeLeasesQuery.data ?? [];
  const unconfirmedDays = unconfirmedQuery.data ?? [];
  // F-2.2's own territory is customer rent; the same receivables report also
  // carries driver arrears, which surface on the driver's own two-balance
  // screen (Web-P4), never duplicated here.
  const rentDue = (receivablesQuery.data ?? []).filter((row) => row.partyType === "customer");
  const depositReleases = depositReleasesQuery.data ?? [];
  const inProgressTrips = tripsQuery.data ?? [];
  const rentDueTotal = sumMinor(rentDue, (row) => row.outstandingMinor);
  const todayExpectedTotal = sumMinor(activeLeases, (row) => row.dailyLeaseAmountMinor);
  const depositReleaseTotal = sumMinor(depositReleases, (row) => row.heldMinor);

  const anySectionHasContent =
    paperworkWarnings.length > 0 ||
    activeLeases.length > 0 ||
    unconfirmedDays.length > 0 ||
    rentDue.length > 0 ||
    depositReleases.length > 0 ||
    inProgressTrips.length > 0;
  const anySectionErrored =
    paperworkState.kind === "error" ||
    activeLeasesState.kind === "error" ||
    unconfirmedState.kind === "error" ||
    receivablesState.kind === "error" ||
    depositReleasesState.kind === "error" ||
    tripsState.kind === "error";
  const allSectionsReady =
    paperworkState.kind === "ready" &&
    activeLeasesState.kind === "ready" &&
    unconfirmedState.kind === "ready" &&
    receivablesState.kind === "ready" &&
    depositReleasesState.kind === "ready" &&
    tripsState.kind === "ready";
  const hasSecondaryContent =
    rentDue.length > 0 ||
    depositReleases.length > 0 ||
    inProgressTrips.length > 0 ||
    receivablesState.kind === "error" ||
    depositReleasesState.kind === "error" ||
    tripsState.kind === "error";

  return (
    <Screen title="Home" contentWidth="wide">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:items-start">
        {!anySectionHasContent && !anySectionErrored && allSectionsReady ? (
          <div className="lg:col-span-2">
            <EmptyState message="Nothing needs you today" detail={formatHomeDate(today)} />
          </div>
        ) : null}
        {!anySectionHasContent && !anySectionErrored && !allSectionsReady ? (
          <div className="lg:col-span-2">
            <p className="p-4 text-body-sm text-ink-muted">Loading…</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 lg:col-span-2">
          {paperworkState.kind === "error" ? (
            <QueryStateFailure
              error={paperworkState.error}
              retry={paperworkState.retry}
              of="paperwork warnings"
            />
          ) : null}
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
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{paperworkTitle(row)}</span>
                <span>{paperworkMessage(row)}</span>
              </span>
            </AlertStrip>
          ))}
        </div>

        {anySectionHasContent ? (
          <Card className="flex flex-wrap divide-x divide-line-hairline p-0 lg:col-span-2">
            <HomeSummaryItem
              label="Rent due"
              icon={Banknote}
              tone={
                receivablesState.kind === "error"
                  ? "warning"
                  : rentDue.length > 0
                    ? "critical"
                    : "good"
              }
              value={
                receivablesState.kind === "error" ? (
                  <NotAvailable reason="read failed" className="text-body-sm" />
                ) : receivablesState.kind !== "ready" ? (
                  <NotAvailable reason="loading" className="text-body-sm" />
                ) : (
                  <Money value={rentDueTotal} />
                )
              }
              detail={
                receivablesState.kind === "error"
                  ? "Needs retry"
                  : receivablesState.kind !== "ready"
                    ? "Loading"
                    : `${rentDue.length.toString()} customer ${rentDue.length === 1 ? "balance" : "balances"}`
              }
            />
            <HomeSummaryItem
              label="Trips"
              icon={Route}
              tone={
                tripsState.kind === "error"
                  ? "warning"
                  : inProgressTrips.length > 0
                    ? "brand"
                    : "good"
              }
              value={
                tripsState.kind === "error" ? (
                  <NotAvailable reason="read failed" className="text-body-sm" />
                ) : tripsState.kind !== "ready" ? (
                  <NotAvailable reason="loading" className="text-body-sm" />
                ) : (
                  <span className="tabular-nums">{inProgressTrips.length}</span>
                )
              }
              detail={
                tripsState.kind === "error"
                  ? "Needs retry"
                  : tripsState.kind !== "ready"
                    ? "Loading"
                    : "Open trip containers"
              }
            />
            <HomeSummaryItem
              label="Expected"
              icon={CalendarCheck}
              tone={
                activeLeasesState.kind === "error"
                  ? "warning"
                  : activeLeases.length > 0
                    ? "brand"
                    : "good"
              }
              value={
                activeLeasesState.kind === "error" ? (
                  <NotAvailable reason="read failed" className="text-body-sm" />
                ) : activeLeasesState.kind !== "ready" ? (
                  <NotAvailable reason="loading" className="text-body-sm" />
                ) : (
                  <Money value={todayExpectedTotal} />
                )
              }
              detail={
                activeLeasesState.kind === "error"
                  ? "Needs retry"
                  : activeLeasesState.kind !== "ready"
                    ? "Loading"
                    : `${activeLeases.length.toString()} ${activeLeases.length === 1 ? "vehicle" : "vehicles"} to confirm`
              }
            />
          </Card>
        ) : null}

        <div className="flex flex-col gap-4">
          {activeLeasesState.kind === "error" ? (
            <QueryStateFailure
              error={activeLeasesState.error}
              retry={activeLeasesState.retry}
              of="today's vehicles"
            />
          ) : null}
          {activeLeases.length > 0 ? <TodayCards leases={activeLeases} today={today} /> : null}

          {/* Reuses ConfirmDayCard verbatim for a past date. F-4.3/GAP-2 landed
            a daily lease's own effective-dated rate history, so a date here
            can now genuinely differ from the lease's CURRENT rate — but
            ConfirmDayCard's own `expectedMinor` derivation already prefers
            the already-materialised `open` row's own figure over the
            lease's current rate, and every row this section lists is
            already `state = 'open'` by definition (`listUnconfirmedDayRecordsForBusiness`'s
            own filter). `changeDailyLeaseRate`'s own `repriceFutureOpenDayRecords`
            keeps that figure correct across a rate change, so no
            date-aware lookup was needed here after all — only the write
            side (domain/dailyLease.ts) had to change. */}
          {unconfirmedState.kind === "error" ? (
            <QueryStateFailure
              error={unconfirmedState.error}
              retry={unconfirmedState.retry}
              of="earlier unconfirmed days"
            />
          ) : null}
          {unconfirmedDays.length > 0 ? (
            <Section
              title="Earlier days"
              count={unconfirmedDays.length}
              items={groupUnconfirmedByLease(unconfirmedDays).flatMap((group) => {
                if (group.days.length >= 2) {
                  return [
                    <ConfirmWeekGroupCard
                      key={group.dailyLeaseId}
                      dailyLeaseId={group.dailyLeaseId}
                      vehicleLabel={group.vehicleRegistration}
                      driverLabel={group.driverName}
                      days={group.days}
                    />,
                  ];
                }
                const [only] = group.days;
                if (only === undefined) return [];
                return [
                  <ConfirmDayCard
                    key={only.id}
                    dailyLeaseId={group.dailyLeaseId}
                    vehicleLabel={group.vehicleRegistration}
                    driverLabel={group.driverName}
                    dateLabel={formatHomeDate(only.businessDate)}
                    today={asBusinessDate(only.businessDate)}
                    elevated={false}
                  />,
                ];
              })}
            />
          ) : null}
        </div>

        {hasSecondaryContent ? (
          <aside className="flex flex-col gap-4 lg:sticky lg:top-4" aria-label="Waiting work">
            {receivablesState.kind === "error" ? (
              <QueryStateFailure
                error={receivablesState.error}
                retry={receivablesState.retry}
                of="rent due"
              />
            ) : null}
            {rentDue.length > 0 ? (
              <Section
                title="Rent due"
                count={rentDue.length}
                total={<Money value={rentDueTotal} />}
                items={rentDue.map((row) => (
                  <Card
                    key={row.partyId}
                    accent="critical"
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Banknote className="size-5 shrink-0 text-critical-ink" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-title text-ink-primary">
                          {row.partyName ?? "—"}
                        </p>
                        <p className="text-body-sm text-ink-muted">
                          {dueLabel(row.oldestDueOn, today)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="critical">Due</Badge>
                      <Money value={parse(row.outstandingMinor)} />
                    </div>
                  </Card>
                ))}
              />
            ) : null}

            {depositReleasesState.kind === "error" ? (
              <QueryStateFailure
                error={depositReleasesState.error}
                retry={depositReleasesState.retry}
                of="deposits to release"
              />
            ) : null}
            {depositReleases.length > 0 ? (
              <Section
                title="Deposits to release"
                count={depositReleases.length}
                total={<Money value={depositReleaseTotal} />}
                items={depositReleases.map((row) => (
                  <Card
                    key={row.depositId}
                    accent="warning"
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <HandCoins className="size-5 shrink-0 text-warning-ink" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-title text-ink-primary">
                          {row.partyName ?? "—"}
                        </p>
                        <p className="text-body-sm text-ink-muted">
                          Held since {formatShortDate(row.holdReleaseDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="warning">Release</Badge>
                      <Money value={parse(row.heldMinor)} />
                    </div>
                  </Card>
                ))}
              />
            ) : null}

            {tripsState.kind === "error" ? (
              <QueryStateFailure
                error={tripsState.error}
                retry={tripsState.retry}
                of="trips in progress"
              />
            ) : null}
            {inProgressTrips.length > 0 ? (
              <Section
                title="Trips in progress"
                count={inProgressTrips.length}
                items={inProgressTrips.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelectTrip(row.id)}
                    className="w-full text-left"
                  >
                    <Card accent="brand" className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Route className="size-5 shrink-0 text-brand-ink" aria-hidden />
                        <div className="min-w-0">
                          <p className="truncate text-title text-ink-primary">
                            {row.vehicleRegistration}
                          </p>
                          <p className="text-body-sm text-ink-muted">
                            {row.destination ?? "No destination recorded"} ·{" "}
                            {formatDateRange(row.startDate, row.endDate)}
                          </p>
                        </div>
                      </div>
                      <Badge variant="brand" className="shrink-0 whitespace-nowrap">
                        Open
                      </Badge>
                    </Card>
                  </button>
                ))}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </Screen>
  );
}
