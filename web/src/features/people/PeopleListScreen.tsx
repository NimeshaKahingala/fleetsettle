import type { CustomerResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateCustomerForm } from "./CreateCustomerForm.js";
import { CreateDriverForm } from "./CreateDriverForm.js";

export interface PeopleListScreenProps {
  onSelectDriver: (driver: DriverResponse) => void;
  onSelectCustomer: (customer: CustomerResponse) => void;
}

function customerTypeLabel(type: CustomerResponse["customerType"]): string {
  return type === "person" ? "Person" : "Organisation";
}

/** §3.1's People tab: drivers and customers. A driver's own page (the two-balance screen) is F-6.x's territory, not built here. */
export function PeopleListScreen({ onSelectDriver, onSelectCustomer }: PeopleListScreenProps) {
  const api = useApi();
  const [addOpen, setAddOpen] = useState(false);
  const [addDriverOpen, setAddDriverOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  const driversQuery = useQuery({
    queryKey: ["drivers"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
  });
  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
  });
  // GAP-101: a failed list must not read as "you have no drivers" — `?? []`
  // on its own can't tell "empty" from "the read failed" apart.
  const driversState = useQueryState(driversQuery);
  const customersState = useQueryState(customersQuery);
  const drivers = driversQuery.data;
  const customers = customersQuery.data;

  return (
    <Screen title="People" action={{ label: "Add", icon: Plus, onClick: () => setAddOpen(true) }}>
      <div className="flex flex-col gap-6">
        {driversState.kind === "error" ? (
          <QueryStateFailure error={driversState.error} retry={driversState.retry} of="drivers" />
        ) : (
          <Section
            title="Drivers"
            count={drivers?.length ?? 0}
            items={(drivers ?? []).map((driver) => (
              <button
                key={driver.id}
                type="button"
                onClick={() => onSelectDriver(driver)}
                className="w-full text-left"
              >
                <Card className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserRound className="size-5 shrink-0 text-ink-muted" aria-hidden />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-title text-ink-primary">{driver.name}</p>
                        <Badge variant="neutral">Driver</Badge>
                      </div>
                      {driver.mobile !== null ? (
                        <p className="truncate text-body-sm text-ink-muted">{driver.mobile}</p>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </Card>
              </button>
            ))}
          />
        )}
        {customersState.kind === "error" ? (
          <QueryStateFailure
            error={customersState.error}
            retry={customersState.retry}
            of="customers"
          />
        ) : (
          <Section
            title="Customers"
            count={customers?.length ?? 0}
            items={(customers ?? []).map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => onSelectCustomer(customer)}
                className="w-full text-left"
              >
                <Card className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {customer.customerType === "person" ? (
                      <UserRound className="size-5 shrink-0 text-ink-muted" aria-hidden />
                    ) : (
                      <Building2 className="size-5 shrink-0 text-ink-muted" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-title text-ink-primary">{customer.name}</p>
                        <Badge variant="neutral">{customerTypeLabel(customer.customerType)}</Badge>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </Card>
              </button>
            ))}
          />
        )}
      </div>

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add"
        actions={[
          {
            key: "driver",
            label: "Add a driver",
            icon: UserRound,
            onSelect: () => setAddDriverOpen(true),
          },
          {
            key: "customer",
            label: "Add a customer",
            icon: Building2,
            onSelect: () => setAddCustomerOpen(true),
          },
        ]}
      />

      <Sheet open={addDriverOpen} onOpenChange={setAddDriverOpen} title="Add a driver">
        <CreateDriverForm onCreated={() => setAddDriverOpen(false)} />
      </Sheet>
      <Sheet open={addCustomerOpen} onOpenChange={setAddCustomerOpen} title="Add a customer">
        <CreateCustomerForm onCreated={() => setAddCustomerOpen(false)} />
      </Sheet>
    </Screen>
  );
}
