import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { BankingEventResponse, CashPositionResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ChevronRight, HandCoins, Landmark } from "lucide-react";
import { useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface CashScreenProps {
  today: BusinessDate;
  onSelectPartner: (userId: string) => void;
  onBack: () => void;
}

function partnerName(name: string | null): string {
  return name ?? "Unnamed partner";
}

function BankingEventSheet({
  open,
  onOpenChange,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountRecordedMinor, setAmountRecordedMinor] = useState<Minor | null>(null);
  const [amountCountedMinor, setAmountCountedMinor] = useState<Minor | null>(null);
  const [bankedOn, setBankedOn] = useState<BusinessDate>(today);
  const [destination, setDestination] = useState("");
  const [reference, setReference] = useState("");
  const [discrepancyBearer, setDiscrepancyBearer] = useState<"absorbed" | "unattributed">(
    "unattributed",
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (amountRecordedMinor === null || amountCountedMinor === null) {
        throw new Error("Enter both banking amounts");
      }
      const hasDiscrepancy = amountCountedMinor !== amountRecordedMinor;
      return api.post<BankingEventResponse>("/api/banking-event", {
        amountRecordedMinor: toWire(amountRecordedMinor),
        amountCountedMinor: toWire(amountCountedMinor),
        bankedOn,
        destination: destination.trim(),
        ...(reference.trim().length > 0 ? { reference: reference.trim() } : {}),
        ...(hasDiscrepancy ? { discrepancyBearer } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reports", "cash-position"] });
      void queryClient.invalidateQueries({ queryKey: ["banking-event"] });
      setAmountRecordedMinor(null);
      setAmountCountedMinor(null);
      setDestination("");
      setReference("");
      setBankedOn(today);
      onOpenChange(false);
    },
  });

  const hasDiscrepancy =
    amountRecordedMinor !== null &&
    amountCountedMinor !== null &&
    amountRecordedMinor !== amountCountedMinor;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record banking">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <MoneyField
          label="Recorded amount"
          valueMinor={amountRecordedMinor}
          onChange={setAmountRecordedMinor}
        />
        <MoneyField
          label="Counted amount"
          valueMinor={amountCountedMinor}
          onChange={setAmountCountedMinor}
        />
        <DateField label="Banked on" value={bankedOn} today={today} onChange={setBankedOn} />
        <Field label="Destination" htmlFor="bankDestination">
          <Input
            id="bankDestination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </Field>
        <Field label="Reference" htmlFor="bankReference" optional>
          <Input
            id="bankReference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        {hasDiscrepancy ? (
          <div className="flex flex-col gap-1">
            <span className="text-label font-medium text-ink-secondary">Shortfall bearer</span>
            <div className="grid grid-cols-2 gap-2">
              {(["unattributed", "absorbed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={discrepancyBearer === value}
                  onClick={() => setDiscrepancyBearer(value)}
                  className={
                    discrepancyBearer === value
                      ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                      : "min-h-tap rounded-sm border border-line-strong px-2 text-body-sm text-ink-primary"
                  }
                >
                  {value === "unattributed" ? "Unattributed" : "Absorbed"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={
            amountRecordedMinor === null || amountCountedMinor === null || destination.trim() === ""
          }
        >
          Save banking
        </Button>
      </form>
    </Sheet>
  );
}

export function CashScreen({ today, onSelectPartner, onBack }: CashScreenProps) {
  const api = useApi();
  const [bankingOpen, setBankingOpen] = useState(false);
  const cashQuery = useQuery({
    queryKey: ["reports", "cash-position"],
    queryFn: () => api.get<CashPositionResponse>("/api/reports/cash-position"),
  });
  const cashState = useQueryState(cashQuery);
  const cash = cashQuery.data;

  return (
    <Screen
      title="Cash"
      onBack={onBack}
      action={{ label: "Record banking", icon: Banknote, onClick: () => setBankingOpen(true) }}
    >
      {cashState.kind === "error" ? (
        <QueryStateFailure error={cashState.error} retry={cashState.retry} of="the cash position" />
      ) : cash === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <StatTile
            label="Held as deposits"
            value={<Money value={BigInt(cash.depositsHeldMinor) as Minor} />}
            size="hero"
          />
          <Section
            title="Partners holding cash"
            count={cash.partners.length}
            items={cash.partners.map((partner) => (
              <button
                key={partner.userId}
                type="button"
                onClick={() => onSelectPartner(partner.userId)}
                className="w-full text-left"
              >
                <Card className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <HandCoins className="size-5 shrink-0 text-ink-secondary" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-body text-ink-primary">
                        {partnerName(partner.displayName)}
                      </p>
                      <p className="text-caption text-ink-muted">Holding</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money value={BigInt(partner.heldMinor) as Minor} />
                    <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                  </div>
                </Card>
              </button>
            ))}
          />
          {cash.banked.length > 0 ? (
            <Section
              title="Banked"
              count={cash.banked.length}
              items={cash.banked.map((row) => (
                <Card key={row.destination} className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Landmark className="size-5 shrink-0 text-ink-secondary" aria-hidden />
                    <p className="min-w-0 truncate text-body text-ink-primary">{row.destination}</p>
                  </div>
                  <Money value={BigInt(row.heldMinor) as Minor} />
                </Card>
              ))}
            />
          ) : null}
        </div>
      )}
      <BankingEventSheet open={bankingOpen} onOpenChange={setBankingOpen} today={today} />
    </Screen>
  );
}
