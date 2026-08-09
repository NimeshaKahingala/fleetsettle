import type { BusinessDate } from "@fleetsettle/shared";
import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { ARRANGEMENT_BADGE_VARIANT, ARRANGEMENT_LABEL } from "../../lib/arrangementLabel.js";
import { CreateVehicleForm } from "./CreateVehicleForm.js";

export interface VehicleListScreenProps {
  today: BusinessDate;
  onSelectVehicle: (vehicle: VehicleResponse) => void;
}

/** F-1.1's list — the Vehicles tab (§3.1): list → vehicle → overview. */
export function VehicleListScreen({ today, onSelectVehicle }: VehicleListScreenProps) {
  const api = useApi();
  const [addOpen, setAddOpen] = useState(false);
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });

  return (
    <Screen
      title="Vehicles"
      action={{ label: "Add a vehicle", icon: Plus, onClick: () => setAddOpen(true) }}
    >
      {isLoading ? (
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
                  <div>
                    <p className="text-title text-ink-primary">{vehicle.registration}</p>
                    <p className="text-body-sm text-ink-muted">{vehicle.vehicleType}</p>
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
