import type { CustomerResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { ActionSheet } from "../../design/primitives/ActionSheet.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { CreateCustomerForm } from "./CreateCustomerForm.js";
import { CreateDriverForm } from "./CreateDriverForm.js";

export interface PeopleListScreenProps {
  onSelectDriver: (driver: DriverResponse) => void;
  onSelectCustomer: (customer: CustomerResponse) => void;
}

/** §3.1's People tab: drivers and customers. A driver's own page (the two-balance screen) is F-6.x's territory, not built here. */
export function PeopleListScreen({ onSelectDriver, onSelectCustomer }: PeopleListScreenProps) {
  const api = useApi();
  const [addOpen, setAddOpen] = useState(false);
  const [addDriverOpen, setAddDriverOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
  });
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
  });

  return (
    <Screen title="People" action={{ label: "Add", icon: Plus, onClick: () => setAddOpen(true) }}>
      <div className="flex flex-col gap-6">
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
                <div>
                  <p className="text-title text-ink-primary">{driver.name}</p>
                  {driver.mobile !== null ? (
                    <p className="text-body-sm text-ink-muted">{driver.mobile}</p>
                  ) : null}
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </Card>
            </button>
          ))}
        />
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
                <div>
                  <p className="text-title text-ink-primary">{customer.name}</p>
                  <p className="text-body-sm text-ink-muted">
                    {customer.customerType === "person" ? "Person" : "Organisation"}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </Card>
            </button>
          ))}
        />
      </div>

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add"
        actions={[
          {
            key: "driver",
            label: "Add a driver",
            icon: Plus,
            onSelect: () => setAddDriverOpen(true),
          },
          {
            key: "customer",
            label: "Add a customer",
            icon: Plus,
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
