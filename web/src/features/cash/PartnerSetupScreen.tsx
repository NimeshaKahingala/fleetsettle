import { parse, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ManagementFeeAgreementResponse,
  OwnershipShareResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Handshake,
  MoreVertical,
  Percent,
  UserRoundCog,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { can } from "../../lib/capabilities.js";
import { useMe } from "../../lib/useMe.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface PartnerSetupScreenProps {
  today: BusinessDate;
  onBack: () => void;
}

const EMPTY_VEHICLES: VehicleResponse[] = [];
const EMPTY_MEMBERS: BusinessMemberResponse[] = [];
const EMPTY_SHARES: OwnershipShareResponse[] = [];
const EMPTY_AGREEMENTS: ManagementFeeAgreementResponse[] = [];

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatPercent(bp: number): string {
  const fractional = bp % 100;
  const whole = (bp - fractional) / 100;
  if (fractional === 0) return `${String(whole)}%`;
  return `${String(whole)}.${String(fractional).padStart(2, "0").replace(/0+$/, "")}%`;
}

function percentInputToBp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;

  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fractionalText = match[2] ?? "";
  const fractional = Number.parseInt(fractionalText.padEnd(2, "0") || "0", 10);
  const bp = whole * 100 + fractional;
  return bp > 0 && bp <= 10000 ? bp : null;
}

function memberName(member: BusinessMemberResponse): string {
  return member.displayName ?? "Unnamed member";
}

function vehicleName(vehicle: VehicleResponse | undefined, vehicleId: string): string {
  return vehicle?.registration ?? vehicleId;
}

function NativeSelect({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={[
        "min-h-tap w-full rounded-sm border border-line-strong bg-surface px-3 text-body text-ink-primary",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

function defaultShareInputs(partners: BusinessMemberResponse[]): Record<string, string> {
  const values: Record<string, string> = {};
  partners.forEach((partner, index) => {
    values[partner.userId] = index === 0 ? "100" : "";
  });
  return values;
}

function OwnershipSharesSheet({
  open,
  onOpenChange,
  today,
  vehicles,
  partners,
  currentShares,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  vehicles: VehicleResponse[];
  partners: BusinessMemberResponse[];
  currentShares: OwnershipShareResponse[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);
  const [shareInputs, setShareInputs] = useState<Record<string, string>>(
    defaultShareInputs(partners),
  );
  const currentVehicleIds = useMemo(
    () => new Set(currentShares.map((share) => share.vehicleId)),
    [currentShares],
  );
  const availableVehicles = vehicles.filter((vehicle) => !currentVehicleIds.has(vehicle.id));

  const parsedShares = partners
    .map((partner) => {
      const shareBp = percentInputToBp(shareInputs[partner.userId] ?? "");
      return shareBp === null ? null : { userId: partner.userId, shareBp };
    })
    .filter((share): share is { userId: string; shareBp: number } => share !== null);
  const totalBp = parsedShares.reduce((sum, share) => sum + share.shareBp, 0);
  const hasInvalidEnteredShare = partners.some((partner) => {
    const value = shareInputs[partner.userId] ?? "";
    return value.trim() !== "" && percentInputToBp(value) === null;
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<OwnershipShareResponse[]>("/api/ownership-share", {
        vehicleId,
        effectiveFrom,
        shares: parsedShares,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ownership-share"] });
      void queryClient.invalidateQueries({ queryKey: ["partner"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setVehicleId("");
      setEffectiveFrom(today);
      setShareInputs(defaultShareInputs(partners));
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    setVehicleId("");
    setEffectiveFrom(today);
    setShareInputs(defaultShareInputs(partners));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation.reset is stable enough for this open-reset effect; including the mutation object resets on each render.
  }, [open, partners, today]);

  const canSave =
    vehicleId !== "" &&
    parsedShares.length > 0 &&
    totalBp === 10000 &&
    !hasInvalidEnteredShare &&
    !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Set ownership shares">
      {partners.length === 0 || availableVehicles.length === 0 ? (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-body text-ink-secondary">
              {partners.length === 0
                ? "No owner members are active."
                : "Every active vehicle already has a current split."}
            </p>
          </Card>
          <Button size="cta" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Vehicle" htmlFor="ownershipVehicle">
            <NativeSelect
              id="ownershipVehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Choose vehicle</option>
              {availableVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DateField
            label="Effective from"
            value={effectiveFrom}
            today={today}
            onChange={setEffectiveFrom}
          />
          {partners.map((partner) => {
            const id = `share-${partner.userId}`;
            const value = shareInputs[partner.userId] ?? "";
            const error =
              value.trim() !== "" && percentInputToBp(value) === null
                ? "Use a percentage from 0.01 to 100."
                : undefined;
            return (
              <Field
                key={partner.userId}
                label={`${memberName(partner)} share`}
                htmlFor={id}
                error={error}
              >
                <Input
                  id={id}
                  inputMode="decimal"
                  value={value}
                  onChange={(e) =>
                    setShareInputs((current) => ({
                      ...current,
                      [partner.userId]: e.target.value,
                    }))
                  }
                  aria-invalid={error !== undefined}
                />
              </Field>
            );
          })}
          <Card className="flex items-center justify-between gap-3">
            <span className="text-body text-ink-secondary">Total</span>
            <span
              className={
                totalBp === 10000
                  ? "flex items-center gap-1.5 text-body font-medium text-good-ink"
                  : "flex items-center gap-1.5 text-body font-medium text-critical-ink"
              }
            >
              {totalBp === 10000 ? (
                <CircleCheck className="size-4 shrink-0" aria-hidden />
              ) : (
                <CircleAlert className="size-4 shrink-0" aria-hidden />
              )}
              {formatPercent(totalBp)}
              {totalBp === 10000 ? " — totals 100%" : " — must total 100%"}
            </span>
          </Card>
          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
          <Button type="submit" size="cta" disabled={!canSave}>
            Save shares
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function ManagementAgreementSheet({
  open,
  onOpenChange,
  today,
  vehicles,
  managers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  vehicles: VehicleResponse[];
  managers: BusinessMemberResponse[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [monthlyFeeMinor, setMonthlyFeeMinor] = useState<Minor | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        vehicleId,
        managerUserId,
        effectiveFrom,
        ...(monthlyFeeMinor !== null ? { monthlyFeeMinor: toWire(monthlyFeeMinor) } : {}),
      };
      return api.post<ManagementFeeAgreementResponse>("/api/management-fee-agreement", body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["management-fee-agreement"] });
      void queryClient.invalidateQueries({ queryKey: ["partner"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setVehicleId("");
      setManagerUserId("");
      setMonthlyFeeMinor(null);
      setEffectiveFrom(today);
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    setVehicleId("");
    setManagerUserId("");
    setMonthlyFeeMinor(null);
    setEffectiveFrom(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation.reset is stable enough for this open-reset effect; including the mutation object resets on each render.
  }, [open, today]);

  const canSave = vehicleId !== "" && managerUserId !== "" && !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Share vehicle">
      {vehicles.length === 0 || managers.length === 0 ? (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-body text-ink-secondary">
              {vehicles.length === 0 ? "No active vehicles." : "No manager members are active."}
            </p>
          </Card>
          <Button size="cta" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Vehicle" htmlFor="managementVehicle">
            <NativeSelect
              id="managementVehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Choose vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Manager" htmlFor="managementManager">
            <NativeSelect
              id="managementManager"
              value={managerUserId}
              onChange={(e) => setManagerUserId(e.target.value)}
            >
              <option value="">Choose manager</option>
              {managers.map((manager) => (
                <option key={manager.userId} value={manager.userId}>
                  {memberName(manager)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <MoneyField
            label="Monthly management fee (optional)"
            valueMinor={monthlyFeeMinor}
            onChange={setMonthlyFeeMinor}
          />
          <DateField
            label="Effective from"
            value={effectiveFrom}
            today={today}
            onChange={setEffectiveFrom}
          />
          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
          <Button type="submit" size="cta" disabled={!canSave}>
            Save sharing
          </Button>
        </form>
      )}
    </Sheet>
  );
}

export function PartnerSetupScreen({ today, onBack }: PartnerSetupScreenProps) {
  const api = useApi();
  const me = useMe();
  const queryClient = useQueryClient();
  const canManagePartnerCapital = can(me.role, "managePartnerCapital");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [ownershipOpen, setOwnershipOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<ManagementFeeAgreementResponse | null>(
    null,
  );
  const [revokeOpen, setRevokeOpen] = useState(false);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicle"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });
  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
  });
  const sharesQuery = useQuery({
    queryKey: ["ownership-share"],
    queryFn: () => api.get<OwnershipShareResponse[]>("/api/ownership-share"),
  });
  const agreementsQuery = useQuery({
    queryKey: ["management-fee-agreement"],
    queryFn: () => api.get<ManagementFeeAgreementResponse[]>("/api/management-fee-agreement"),
  });

  const vehicleState = useQueryState(vehiclesQuery);
  const memberState = useQueryState(membersQuery);
  const sharesState = useQueryState(sharesQuery);
  const agreementsState = useQueryState(agreementsQuery);
  const failedState =
    vehicleState.kind === "error"
      ? vehicleState
      : memberState.kind === "error"
        ? memberState
        : sharesState.kind === "error"
          ? sharesState
          : agreementsState.kind === "error"
            ? agreementsState
            : null;

  const vehicles = vehiclesQuery.data ?? EMPTY_VEHICLES;
  const members = membersQuery.data ?? EMPTY_MEMBERS;
  const shares = sharesQuery.data ?? EMPTY_SHARES;
  const agreements = agreementsQuery.data ?? EMPTY_AGREEMENTS;
  const partners = members.filter((member) => member.role !== "manager");
  const managers = members.filter((member) => member.role === "manager");
  const vehiclesById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles],
  );
  const membersByUserId = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const sharesByVehicle = useMemo(() => {
    const grouped = new Map<string, OwnershipShareResponse[]>();
    for (const share of shares) {
      const rows = grouped.get(share.vehicleId) ?? [];
      rows.push(share);
      grouped.set(share.vehicleId, rows);
    }
    return Array.from(grouped.entries());
  }, [shares]);

  const revokeMutation = useMutation({
    mutationFn: (agreement: ManagementFeeAgreementResponse) =>
      api.post<ManagementFeeAgreementResponse>(
        `/api/management-fee-agreement/${agreement.id}/revoke`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["management-fee-agreement"] });
      void queryClient.invalidateQueries({ queryKey: ["partner"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setRevokeOpen(false);
      setSelectedAgreement(null);
    },
  });

  const actions: ActionSheetAction[] = [
    {
      key: "ownership",
      label: "Set ownership shares",
      icon: Percent,
      onSelect: () => setOwnershipOpen(true),
    },
    {
      key: "management",
      label: "Share vehicle",
      icon: Handshake,
      onSelect: () => setManagementOpen(true),
    },
  ];

  return (
    <Screen
      title="Vehicle sharing"
      onBack={onBack}
      {...(canManagePartnerCapital
        ? { action: { label: "Setup", icon: UserRoundCog, onClick: () => setActionsOpen(true) } }
        : {})}
    >
      {failedState !== null ? (
        <QueryStateFailure
          error={failedState.error}
          retry={failedState.retry}
          of="vehicle sharing"
        />
      ) : vehiclesQuery.data === undefined ||
        membersQuery.data === undefined ||
        sharesQuery.data === undefined ||
        agreementsQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          {sharesByVehicle.length > 0 ? (
            <Section
              title="Ownership shares"
              count={sharesByVehicle.length}
              items={sharesByVehicle.map(([vehicleId, rows]) => {
                const label = rows
                  .map((row) => {
                    const member = membersByUserId.get(row.userId);
                    return `${member !== undefined ? memberName(member) : "Unknown member"} ${formatPercent(row.shareBp)}`;
                  })
                  .join(" · ");
                return (
                  <Card key={vehicleId} className="flex flex-col gap-1">
                    <p className="text-body text-ink-primary">
                      {vehicleName(vehiclesById.get(vehicleId), vehicleId)}
                    </p>
                    <p className="text-caption text-ink-muted">{label}</p>
                    <p className="text-caption text-ink-muted">
                      Effective {formatShortDate(rows[0]?.effectiveFrom ?? today)}
                    </p>
                  </Card>
                );
              })}
            />
          ) : (
            <Card>
              <p className="text-body text-ink-secondary">No ownership shares yet.</p>
            </Card>
          )}

          {agreements.length > 0 ? (
            <Section
              title="Management agreements"
              count={agreements.length}
              items={agreements.map((agreement) => {
                const manager = membersByUserId.get(agreement.managerUserId);
                const active = agreement.effectiveTo === null;
                const row = (
                  <Card className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink-primary">
                        {vehicleName(vehiclesById.get(agreement.vehicleId), agreement.vehicleId)}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {manager !== undefined ? memberName(manager) : "Unknown manager"} ·{" "}
                        {formatShortDate(agreement.effectiveFrom)}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={active ? "good" : "neutral"}>
                          {active ? "Active" : "Revoked"}
                        </Badge>
                        {active ? (
                          <MoreVertical className="size-4 text-ink-muted" aria-hidden />
                        ) : null}
                      </div>
                    </div>
                    <Money value={parse(agreement.monthlyFeeMinor)} />
                  </Card>
                );
                return active ? (
                  <button
                    key={agreement.id}
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedAgreement(agreement);
                      setRevokeOpen(true);
                    }}
                  >
                    {row}
                  </button>
                ) : (
                  <div key={agreement.id}>{row}</div>
                );
              })}
            />
          ) : (
            <Card>
              <p className="text-body text-ink-secondary">No management agreements yet.</p>
            </Card>
          )}
        </div>
      )}

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Vehicle sharing"
        actions={actions}
      />
      <OwnershipSharesSheet
        open={ownershipOpen}
        onOpenChange={setOwnershipOpen}
        today={today}
        vehicles={vehicles}
        partners={partners}
        currentShares={shares}
      />
      <ManagementAgreementSheet
        open={managementOpen}
        onOpenChange={setManagementOpen}
        today={today}
        vehicles={vehicles}
        managers={managers}
      />
      <Sheet open={revokeOpen} onOpenChange={setRevokeOpen} title="Revoke sharing?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            This manager loses access to this vehicle. Their past records stay attributed to them.
          </p>
          {revokeMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{revokeMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Revoke sharing"
            variant="destructive"
            onConfirm={() => {
              if (selectedAgreement !== null) revokeMutation.mutate(selectedAgreement);
            }}
            onCancel={() => setRevokeOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
