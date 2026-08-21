import { type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  ExpenseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Fuel, Receipt, Route } from "lucide-react";
import { useState } from "react";
import { ReasonPicker, type ReasonOption } from "../../components/ReasonPicker.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { FuelFillSheet } from "../costs/FuelFillSheet.js";
import { RecordExpenseSheet } from "../costs/RecordExpenseSheet.js";
import { QuickPaymentSheet, type QuickPaymentParty } from "./QuickPaymentSheet.js";

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
 * B15/GAP-82 finishes the two payment entries M-4 had named since the
 * beginning: a payment received first chooses a customer or driver, and a
 * payment made chooses a driver. Partner payout/settlement remains B2/F-7.2,
 * not a generic Quick Add payment, because that flow records movement
 * between partners rather than settling a customer/driver balance.
 */
export function QuickAddSheet({ open, onOpenChange, today, onBookTrip }: QuickAddSheetProps) {
  const api = useApi();
  const [fuelOpen, setFuelOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [receivedPartyPickerOpen, setReceivedPartyPickerOpen] = useState(false);
  const [paidPartyPickerOpen, setPaidPartyPickerOpen] = useState(false);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [paymentDirection, setPaymentDirection] = useState<"received" | "paid">("received");
  const [paymentParty, setPaymentParty] = useState<QuickPaymentParty | null>(null);
  const [tripVehiclePickerOpen, setTripVehiclePickerOpen] = useState(false);

  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
    enabled: receivedPartyPickerOpen,
  });
  const driversQuery = useQuery({
    queryKey: ["drivers"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
    enabled: receivedPartyPickerOpen || paidPartyPickerOpen,
  });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: tripVehiclePickerOpen,
  });
  const customersState = useQueryState(customersQuery);
  const driversState = useQueryState(driversQuery);
  const vehiclesState = useQueryState(vehiclesQuery);

  // GAP-125/GAP-101: `idle` and `pending` both mean "no rows yet" from
  // ReasonPicker's own vantage — the query is `enabled`-gated on the picker
  // being open, so `idle` only means the fetch hasn't been asked to start
  // yet, not that the picker is closed (this sheet stays mounted with
  // `open={false}` rather than unmounting).
  const inFlight = (s: { kind: string }): boolean => s.kind === "pending" || s.kind === "idle";

  const actions: ActionSheetAction[] = [
    { key: "fuel", label: "Fuel", icon: Fuel, tone: "out", onSelect: () => setFuelOpen(true) },
    {
      key: "expense",
      label: "Expense",
      icon: Receipt,
      tone: "out",
      onSelect: () => setExpenseOpen(true),
    },
    {
      key: "payment-received",
      label: "Payment received",
      icon: ArrowDownLeft,
      tone: "in",
      onSelect: () => setReceivedPartyPickerOpen(true),
    },
    {
      key: "payment-made",
      label: "Payment made",
      icon: ArrowUpRight,
      tone: "out",
      onSelect: () => setPaidPartyPickerOpen(true),
    },
    {
      key: "trip",
      label: "New trip",
      icon: Route,
      onSelect: () => setTripVehiclePickerOpen(true),
    },
  ];

  const receivedPartyReasons: ReasonOption[] = [
    ...(customersQuery.data ?? []).map((customer) => ({
      key: `customer:${customer.id}`,
      label: `Customer - ${customer.name}`,
    })),
    ...(driversQuery.data ?? []).map((driver) => ({
      key: `driver:${driver.id}`,
      label: `Driver - ${driver.name}`,
    })),
  ];
  const paidPartyReasons: ReasonOption[] = (driversQuery.data ?? []).map((driver) => ({
    key: `driver:${driver.id}`,
    label: `Driver - ${driver.name}`,
  }));

  function selectPaymentParty(option: ReasonOption, direction: "received" | "paid") {
    const [partyType, partyId] = option.key.split(":");
    if ((partyType !== "customer" && partyType !== "driver") || partyId === undefined) return;
    setReceivedPartyPickerOpen(false);
    setPaidPartyPickerOpen(false);
    setPaymentDirection(direction);
    setPaymentParty({ partyType, partyId, label: option.label });
    setPaymentSheetOpen(true);
  }

  function selectTripVehicle(option: ReasonOption) {
    onBookTrip(option.key);
  }

  const childSheetOpen =
    fuelOpen ||
    expenseOpen ||
    receivedPartyPickerOpen ||
    paidPartyPickerOpen ||
    paymentSheetOpen ||
    tripVehiclePickerOpen;

  return (
    <>
      <ActionSheet
        open={open && !childSheetOpen}
        onOpenChange={onOpenChange}
        title="Add"
        actions={actions}
      />

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
      <ReasonPicker
        open={receivedPartyPickerOpen && !paymentSheetOpen}
        onOpenChange={setReceivedPartyPickerOpen}
        title="Payment received — choose who paid"
        reasons={receivedPartyReasons}
        onSelect={(option) => selectPaymentParty(option, "received")}
        pending={inFlight(customersState) || inFlight(driversState)}
        {...(customersState.kind === "error"
          ? {
              error: {
                error: customersState.error,
                retry: customersState.retry,
                of: "the customer list",
              },
            }
          : driversState.kind === "error"
            ? {
                error: {
                  error: driversState.error,
                  retry: driversState.retry,
                  of: "the driver list",
                },
              }
            : {})}
      />
      <ReasonPicker
        open={paidPartyPickerOpen && !paymentSheetOpen}
        onOpenChange={setPaidPartyPickerOpen}
        title="Payment made — choose a driver"
        reasons={paidPartyReasons}
        onSelect={(option) => selectPaymentParty(option, "paid")}
        pending={inFlight(driversState)}
        {...(driversState.kind === "error"
          ? {
              error: {
                error: driversState.error,
                retry: driversState.retry,
                of: "the driver list",
              },
            }
          : {})}
      />
      <QuickPaymentSheet
        open={paymentSheetOpen}
        onOpenChange={setPaymentSheetOpen}
        direction={paymentDirection}
        party={paymentParty}
        today={today}
        onRecorded={() => {
          setPaymentParty(null);
          setPaymentSheetOpen(false);
        }}
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
        pending={inFlight(vehiclesState)}
        {...(vehiclesState.kind === "error"
          ? {
              error: {
                error: vehiclesState.error,
                retry: vehiclesState.retry,
                of: "the vehicle list",
              },
            }
          : {})}
      />
    </>
  );
}
