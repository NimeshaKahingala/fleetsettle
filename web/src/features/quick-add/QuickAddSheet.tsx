import { type BusinessDate } from "@fleetsettle/shared";
import type { ExpenseResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Fuel, Receipt, Route } from "lucide-react";
import { useState } from "react";
import { ReasonPicker, type ReasonOption } from "../../components/ReasonPicker.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { FuelFillSheet } from "../costs/FuelFillSheet.js";
import { RecordExpenseSheet } from "../costs/RecordExpenseSheet.js";

export interface QuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  onBookTrip: (vehicleId: string) => void;
}

/**
 * §3.1's `＋` tab (M-4): "not a destination, no route change." M-4's own
 * fixed list names five actions — fuel, expense, payment received, payment
 * made, new trip — in that order, "because muscle memory... is the point."
 * This ships **three of the five**: Fuel and Expense are this phase's own
 * F-numbers (F-3.3/F-3.1); New trip needed only a vehicle picker in front
 * of the route that already exists (`/vehicles/:id/trip/new`, Web-P7).
 * Payment received (F-2.2) already has a real flow, but a lease-scoped one
 * (`CollectPaymentSheet`, reached from a lease's own hub) — this sheet has
 * no lease in scope to open it against, and building a business-wide
 * party/lease picker is real, separate work. Payment made (F-6.1, "pay the
 * driver") has no frontend anywhere yet — not even from a driver's own
 * page. Both are deliberately left off the rendered list rather than
 * wired to a dead tap: `ActionSheet` renders exactly the list it is
 * given and never filters on its own, so growing this list later (as
 * each flow gets built) is a one-line addition here, not a rework.
 */
export function QuickAddSheet({ open, onOpenChange, today, onBookTrip }: QuickAddSheetProps) {
  const api = useApi();
  const [fuelOpen, setFuelOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [tripVehiclePickerOpen, setTripVehiclePickerOpen] = useState(false);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: tripVehiclePickerOpen,
  });

  const actions: ActionSheetAction[] = [
    { key: "fuel", label: "Fuel", icon: Fuel, onSelect: () => setFuelOpen(true) },
    { key: "expense", label: "Expense", icon: Receipt, onSelect: () => setExpenseOpen(true) },
    {
      key: "trip",
      label: "New trip",
      icon: Route,
      onSelect: () => setTripVehiclePickerOpen(true),
    },
  ];

  function selectTripVehicle(option: ReasonOption) {
    onBookTrip(option.key);
  }

  return (
    <>
      <ActionSheet open={open} onOpenChange={onOpenChange} title="Add" actions={actions} />

      <FuelFillSheet
        open={fuelOpen}
        onOpenChange={setFuelOpen}
        today={today}
        onRecorded={() => setFuelOpen(false)}
      />
      <RecordExpenseSheet
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        today={today}
        onRecorded={(_expense: ExpenseResponse) => setExpenseOpen(false)}
      />

      {/* "Pick a vehicle, then go" — reuses `ReasonPicker`'s plain
          single-select list rather than `EntityPicker`, which is a
          trigger-button-plus-its-own-sheet and would nest a second sheet
          behind a button for no reason here. */}
      <ReasonPicker
        open={tripVehiclePickerOpen}
        onOpenChange={setTripVehiclePickerOpen}
        title="New trip — choose a vehicle"
        reasons={(vehiclesQuery.data ?? []).map((v) => ({ key: v.id, label: v.registration }))}
        onSelect={selectTripVehicle}
      />
    </>
  );
}
