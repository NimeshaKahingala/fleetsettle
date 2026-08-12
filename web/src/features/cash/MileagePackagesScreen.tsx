import { parse, toWire, type Minor } from "@fleetsettle/shared";
import type {
  ListMileagePackagesResponse,
  MileagePackageResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface MileagePackagesScreenProps {
  onBack: () => void;
}

function formatKm(km: number): string {
  return `${km.toLocaleString("en-GB")} km/day`;
}

function CreateMileagePackageSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dailyLimitKm, setDailyLimitKm] = useState("");
  const [excessRateMinorPerKm, setExcessRateMinorPerKm] = useState<Minor | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const limit = Number.parseInt(dailyLimitKm, 10);
      if (name.trim() === "" || !Number.isInteger(limit) || limit <= 0) {
        throw new Error("Name and daily limit are required");
      }
      if (excessRateMinorPerKm === null || excessRateMinorPerKm < 0n) {
        throw new Error("Excess fee per km is required");
      }
      return api.post<MileagePackageResponse>("/api/mileage-package", {
        name: name.trim(),
        dailyLimitKm: limit,
        excessRateMinorPerKm: toWire(excessRateMinorPerKm),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mileage-packages"] });
      setName("");
      setDailyLimitKm("");
      setExcessRateMinorPerKm(null);
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add mileage package">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Name" htmlFor="mileagePackageName">
          <Input id="mileagePackageName" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Daily limit" htmlFor="mileagePackageDailyLimit">
          <Input
            id="mileagePackageDailyLimit"
            inputMode="numeric"
            value={dailyLimitKm}
            onChange={(e) => setDailyLimitKm(e.target.value)}
          />
        </Field>
        <MoneyField
          label="Excess fee per km"
          valueMinor={excessRateMinorPerKm}
          onChange={setExcessRateMinorPerKm}
        />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={
            mutation.isPending ||
            name.trim() === "" ||
            dailyLimitKm.trim() === "" ||
            excessRateMinorPerKm === null
          }
        >
          Save package
        </Button>
      </form>
    </Sheet>
  );
}

export function MileagePackagesScreen({ onBack }: MileagePackagesScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<MileagePackageResponse | null>(null);

  const packagesQuery = useQuery({
    queryKey: ["mileage-packages"],
    queryFn: () => api.get<ListMileagePackagesResponse>("/api/mileage-package"),
  });
  const packagesState = useQueryState(packagesQuery);

  const archiveMutation = useMutation({
    mutationFn: (pkg: MileagePackageResponse) =>
      api.post<MileagePackageResponse>(`/api/mileage-package/${pkg.id}/archive`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mileage-packages"] });
      setSelectedPackage(null);
    },
  });

  const actions: ActionSheetAction[] =
    selectedPackage !== null && selectedPackage.archivedAt === null
      ? [
          {
            key: "archive",
            label: "Archive package",
            icon: Archive,
            onSelect: () => archiveMutation.mutate(selectedPackage),
          },
        ]
      : [];

  const packages = packagesQuery.data ?? [];

  return (
    <Screen
      title="Mileage packages"
      onBack={onBack}
      action={{ label: "Add package", icon: Plus, onClick: () => setCreateOpen(true) }}
    >
      {packagesState.kind === "error" ? (
        <QueryStateFailure
          error={packagesState.error}
          retry={packagesState.retry}
          of="the mileage packages"
        />
      ) : packagesState.kind !== "ready" ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : packages.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">No mileage packages yet.</p>
        </Card>
      ) : (
        <Section
          title="Saved packages"
          count={packages.length}
          items={packages.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => setSelectedPackage(pkg)}
              disabled={pkg.archivedAt !== null}
              className="w-full text-left disabled:pointer-events-none"
            >
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body text-ink-primary">{pkg.name}</p>
                    {pkg.archivedAt !== null ? <Badge variant="neutral">Archived</Badge> : null}
                  </div>
                  <p className="text-caption text-ink-muted">{formatKm(pkg.dailyLimitKm)}</p>
                </div>
                <div className="text-right">
                  <Money value={parse(pkg.excessRateMinorPerKm)} />
                  <p className="text-caption text-ink-muted">per excess km</p>
                </div>
              </Card>
            </button>
          ))}
        />
      )}
      {archiveMutation.isError ? (
        <p className="mt-3 text-body-sm text-critical-ink">{archiveMutation.error.message}</p>
      ) : null}
      <CreateMileagePackageSheet open={createOpen} onOpenChange={setCreateOpen} />
      <ActionSheet
        open={selectedPackage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPackage(null);
        }}
        title={selectedPackage?.name ?? "Mileage package"}
        actions={actions}
      />
    </Screen>
  );
}
