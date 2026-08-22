import type { BusinessDate } from "@fleetsettle/shared";
import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { EntityAvatar } from "../../design/primitives/EntityAvatar.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { ARRANGEMENT_BADGE_VARIANT, ARRANGEMENT_LABEL } from "../../lib/arrangementLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateVehicleForm } from "./CreateVehicleForm.js";

export interface VehicleListScreenProps {
  today: BusinessDate;
  onSelectVehicle: (vehicle: VehicleResponse) => void;
}

/** F-1.1's list — the Vehicles tab (§3.1): list → vehicle → overview. */
export function VehicleListScreen({ today, onSelectVehicle }: VehicleListScreenProps) {
  const api = useApi();
  const [addOpen, setAddOpen] = useState(false);
  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });
  const state = useQueryState(vehiclesQuery);
  const vehicles = vehiclesQuery.data;

  return (
    <Screen
      title="Vehicles"
      action={{ label: "Add a vehicle", icon: Plus, onClick: () => setAddOpen(true) }}
    >
      {state.kind === "error" ? (
        <QueryStateFailure error={state.error} retry={state.retry} of="the vehicle list" />
      ) : state.kind !== "ready" ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : vehicles !== undefined && vehicles.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <button
                type="button"
                onClick={() => onSelectVehicle(vehicle)}
                className="w-full text-left"
              >
                <Card
                  accent={
                    vehicle.arrangement !== undefined
                      ? ARRANGEMENT_BADGE_VARIANT[vehicle.arrangement]
                      : undefined
                  }
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <EntityAvatar kind="vehicle" vehicleType={vehicle.vehicleType} />
                    <div className="min-w-0">
                      <p className="truncate text-title text-ink-primary">{vehicle.registration}</p>
                      <p className="truncate text-body-sm text-ink-muted">{vehicle.vehicleType}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {vehicle.arrangement !== undefined ? (
                      <Badge variant={ARRANGEMENT_BADGE_VARIANT[vehicle.arrangement]}>
                        {ARRANGEMENT_LABEL[vehicle.arrangement] ?? vehicle.arrangement}
                      </Badge>
                    ) : null}
                    <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-secondary">No vehicles yet.</p>
      )}

      <Sheet open={addOpen} onOpenChange={setAddOpen} title="Add a vehicle">
        <CreateVehicleForm
          today={today}
          onCreated={() => {
            setAddOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
