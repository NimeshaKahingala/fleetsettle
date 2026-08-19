import { businessToday, parse, type Minor } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  LeaseObligationRow,
  ListPaymentsResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import {
  AGEING_BUCKET_LABEL,
  AGEING_BUCKET_VARIANT,
  computeAgeingBucket,
} from "../../lib/ageingBucket.js";
import { useApi } from "../../lib/ApiContext.js";
import { OBLIGATION_KIND_LABEL, OBLIGATION_STATUS_LABEL } from "../../lib/obligationStatusLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CollectPaymentSheet } from "../leases/CollectPaymentSheet.js";

export interface CustomerDetailScreenProps {
  customerId: string;
  onBack: () => void;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function outstandingMinor(due: LeaseObligationRow): Minor {
  return (BigInt(due.amountMinor) - BigInt(due.settledMinor) - BigInt(due.waivedMinor)) as Minor;
}

function totalOutstandingMinor(dues: LeaseObligationRow[]): Minor {
  return dues.reduce<Minor>((total, due) => (total + outstandingMinor(due)) as Minor, 0n as Minor);
}

function detailRows(customer: CustomerResponse): Array<{ label: string; value: string }> {
  return [
    {
      label: "Type",
      value: customer.customerType === "person" ? "Person" : "Organisation",
    },
    ...(customer.mobile !== null ? [{ label: "Mobile", value: customer.mobile }] : []),
    ...(customer.nic !== null ? [{ label: "NIC", value: customer.nic }] : []),
    ...(customer.registrationNo !== null
      ? [{ label: "Registration", value: customer.registrationNo }]
      : []),
    ...(customer.contactPerson !== null
      ? [{ label: "Contact person", value: customer.contactPerson }]
      : []),
    ...(customer.address !== null ? [{ label: "Address", value: customer.address }] : []),
  ];
}

/**
 * A4/GAP-22: the API already exposes the customer detail, outstanding dues
 * and payment history, but `/people/customers/:customerId` was still routed
 * to `NotBuiltYetScreen`. This screen makes that route useful without adding
 * new API dependency: it reads the existing rows and reuses
 * `CollectPaymentSheet`, whose server write is still party-level and whose
 * preview stays oldest-first.
 */
export function CustomerDetailScreen({ customerId, onBack }: CustomerDetailScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const today = businessToday();
  const [collectOpen, setCollectOpen] = useState(false);

  const customerQuery = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => api.get<CustomerResponse>(`/api/customer/${customerId}`),
  });
  const duesQuery = useQuery({
    queryKey: ["customer", customerId, "obligation"],
    queryFn: () => api.get<LeaseObligationRow[]>(`/api/customer/${customerId}/obligation`),
  });
  const paymentsQuery = useQuery({
    queryKey: ["customer", customerId, "payment"],
    queryFn: () => api.get<ListPaymentsResponse>(`/api/customer/${customerId}/payment`),
  });

  const customerState = useQueryState(customerQuery);
  const duesState = useQueryState(duesQuery);
  const paymentsState = useQueryState(paymentsQuery);
  const customer = customerQuery.data;
  const dues = duesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];

  return (
    <Screen
      title={customer?.name ?? "Customer"}
      onBack={onBack}
      {...(customer !== undefined && duesQuery.data !== undefined
        ? {
            primaryAction: {
              label: "Collect payment",
              onClick: () => setCollectOpen(true),
            },
          }
        : {})}
    >
      {customerState.kind === "error" ? (
        <QueryStateFailure
          error={customerState.error}
          retry={customerState.retry}
          of="this customer"
        />
      ) : customer === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3">
            {detailRows(customer).map((row) => (
              <div key={row.label}>
                <p className="text-label text-ink-secondary">{row.label}</p>
                <p className="text-body text-ink-primary">{row.value}</p>
              </div>
            ))}
          </Card>

          {duesState.kind === "error" ? (
            <QueryStateFailure
              error={duesState.error}
              retry={duesState.retry}
              of="this customer's dues"
            />
          ) : duesQuery.data === undefined ? (
            <p className="text-body-sm text-ink-muted">Loading dues…</p>
          ) : dues.length === 0 ? (
            <Card>
              <p className="text-body text-ink-secondary">No outstanding dues.</p>
            </Card>
          ) : (
            <Section
              title="Outstanding dues"
              count={dues.length}
              total={<Money value={totalOutstandingMinor(dues)} />}
              items={dues.map((due) => {
                const bucket = computeAgeingBucket(due.effectiveDueOn, today);
                return (
                  <Card key={due.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">
                        {OBLIGATION_KIND_LABEL[due.kind] ?? due.kind}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(due.dueOn)} ·{" "}
                        {OBLIGATION_STATUS_LABEL[due.status] ?? due.status}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money value={outstandingMinor(due)} />
                      {/* §7.11: "dues as work queues with due-age chips" */}
                      <Badge variant={AGEING_BUCKET_VARIANT[bucket]}>
                        {AGEING_BUCKET_LABEL[bucket]}
                      </Badge>
                    </div>
                  </Card>
                );
              })}
            />
          )}

          {paymentsState.kind === "error" ? (
            <QueryStateFailure
              error={paymentsState.error}
              retry={paymentsState.retry}
              of="this customer's payments"
            />
          ) : paymentsQuery.data === undefined ? (
            <p className="text-body-sm text-ink-muted">Loading payments…</p>
          ) : payments.length === 0 ? (
            <Card>
              <p className="text-body text-ink-secondary">No payments recorded.</p>
            </Card>
          ) : (
            <Section
              title="Payments"
              count={payments.length}
              items={payments.map((payment) => (
                <Card key={payment.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-body text-ink-primary">
                      {payment.direction === "received" ? "Received" : "Paid"}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {formatShortDate(payment.occurredOn)} · {payment.status}
                    </p>
                  </div>
                  <Money value={parse(payment.amountMinor)} />
                </Card>
              ))}
            />
          )}

          <CollectPaymentSheet
            open={collectOpen}
            onOpenChange={setCollectOpen}
            customerId={customerId}
            customerName={customer.name}
            dues={dues}
            today={today}
            onCollected={() => {
              void queryClient.invalidateQueries({
                queryKey: ["customer", customerId, "obligation"],
              });
              void queryClient.invalidateQueries({ queryKey: ["customer", customerId, "payment"] });
              void queryClient.invalidateQueries({ queryKey: ["payment"] });
              void queryClient.invalidateQueries({ queryKey: ["home"] });
              // GAP-144 (19 Aug 2026 live QA pass, F-7): same gap as
              // QuickPaymentSheet's own fix — Home's "Rent due" list reads
              // `["reports", "receivables"]`, which `["home"]` never reaches.
              void queryClient.invalidateQueries({ queryKey: ["reports"] });
            }}
          />
        </div>
      )}
    </Screen>
  );
}
