import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { NotAvailable } from "../../components/NotAvailable.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";

const ARRANGEMENT_LABEL: Record<string, string> = {
  A: "Lease out",
  B: "Daily lease",
  C: "Trips / charter",
};

export interface VehicleOverviewScreenProps {
  vehicleId: string;
  onBack: () => void;
}

/**
 * F-1.1's overview — §3.3's `/vehicles/:id`. Only what P2 actually has data
 * for renders here: registration, type, current arrangement. The
 * calendar/costs/leases/trips/paperwork tabs the route map describes
 * belong to the phases that build those records (P3, P4, P5, P6) — this
 * screen doesn't fake sections for data that can't exist yet.
 */
export function VehicleOverviewScreen({ vehicleId, onBack }: VehicleOverviewScreenProps) {
  const api = useApi();
  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });

  return (
    <Screen title={vehicle?.registration ?? "Vehicle"} onBack={onBack}>
      {isLoading || vehicle === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-label text-ink-secondary">Registration</p>
            <p className="text-title text-ink-primary">{vehicle.registration}</p>
          </div>
          <div>
            <p className="text-label text-ink-secondary">Type</p>
            <p className="text-body text-ink-primary">{vehicle.vehicleType}</p>
          </div>
          <div>
            <p className="text-label text-ink-secondary">Arrangement</p>
            {vehicle.arrangement !== undefined ? (
              <p className="text-body text-ink-primary">
                {ARRANGEMENT_LABEL[vehicle.arrangement] ?? vehicle.arrangement}
              </p>
            ) : (
              <NotAvailable reason="no active arrangement" />
            )}
          </div>
        </Card>
      )}
    </Screen>
  );
}
