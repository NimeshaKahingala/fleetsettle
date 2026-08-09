import { businessToday, parse } from "@fleetsettle/shared";
import type { DriverBalancesResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, PiggyBank, Wallet } from "lucide-react";
import { useState } from "react";
import { TwoBalances } from "../../components/TwoBalances.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { AdvanceSheet } from "./AdvanceSheet.js";
import { DepositSheet } from "./DepositSheet.js";
import { OffsetSheet } from "./OffsetSheet.js";
import { PayDriverSheet } from "./PayDriverSheet.js";

export interface DriverDetailScreenProps {
  driverId: string;
  onBack: () => void;
}

/**
 * F-6.4/UC-56's two-balance screen, now also F-6.1/F-6.3/F-6.7's home
 * (B13, GAP-63/64/66): pay the driver, record an advance, record a
 * deposit — three write endpoints that existed with no caller until this
 * item, found by the 8 Aug flow-inventory audit. `driverBalancesResponseSchema`
 * gives only the two totals (`owedToUsMinor`/`owedByUsMinor`), never a
 * breakdown — the per-obligation detail lines `TwoBalances`' own props
 * describe (e.g. "6 short days, oldest 14 Jul") aren't backed by any read
 * endpoint yet, so both detail lines are the same "—" `TwoBalances.test.tsx`
 * already uses for "nothing specific to say," rather than a fabricated one.
 * History sections (days, trips, advances, deposit — §3.3's route map) are
 * a separate, larger gap, recorded rather than half-built here.
 *
 * **The three new actions are deliberately not crammed into `TwoBalances`**
 * — its own doc comment reserves it to the one action it already has
 * ("`Offset…` is the only action"). They live behind `Screen`'s own
 * primary action instead, the same `ActionSheet` shape `QuickAddSheet`
 * already establishes for "pick one of several related actions."
 */
export function DriverDetailScreen({ driverId, onBack }: DriverDetailScreenProps) {
  const api = useApi();
  const today = businessToday();
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => api.get<DriverResponse>(`/api/driver/${driverId}`),
  });
  const balancesQuery = useQuery({
    queryKey: ["driver", driverId, "balances"],
    queryFn: () => api.get<DriverBalancesResponse>(`/api/driver/${driverId}/balances`),
  });

  const actions: ActionSheetAction[] = [
    { key: "pay", label: "Pay the driver", icon: HandCoins, onSelect: () => setPayOpen(true) },
    {
      key: "advance",
      label: "Record an advance",
      icon: Wallet,
      onSelect: () => setAdvanceOpen(true),
    },
    {
      key: "deposit",
      label: "Record a deposit",
      icon: PiggyBank,
      onSelect: () => setDepositOpen(true),
    },
  ];

  return (
    <Screen
      title={driverQuery.data?.name ?? "Driver"}
      onBack={onBack}
      primaryAction={{ label: "Driver money", onClick: () => setActionsOpen(true) }}
    >
      {driverQuery.data === undefined || balancesQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <TwoBalances
          owedToYouMinor={parse(balancesQuery.data.owedToUsMinor)}
          owedToYouDetail="—"
          owedByYouMinor={parse(balancesQuery.data.owedByUsMinor)}
          owedByYouDetail="—"
          onOffset={() => setOffsetOpen(true)}
        />
      )}
      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Driver money"
        actions={actions}
      />
      <OffsetSheet
        open={offsetOpen}
        onOpenChange={setOffsetOpen}
        driverId={driverId}
        today={today}
      />
      <PayDriverSheet open={payOpen} onOpenChange={setPayOpen} driverId={driverId} today={today} />
      <AdvanceSheet
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        driverId={driverId}
        today={today}
      />
      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        driverId={driverId}
        today={today}
      />
    </Screen>
  );
}
