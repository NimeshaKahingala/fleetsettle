import { newId } from "@fleetsettle/shared";
import type { Writer } from "../../src/db/client.js";

interface BusinessOverrides {
  name?: string;
  currencyCode?: string;
  timezone?: string;
}

interface OpenPeriodOverrides {
  periodStart?: string;
  periodEnd?: string;
}

interface VehicleOverrides {
  registration?: string;
  vehicleType?: string;
}

interface DriverOverrides {
  name?: string;
  dailyFeeMinor?: bigint;
}

interface CustomerOverrides {
  name?: string;
  mobile?: string;
}

interface LeaseOverrides {
  startDate?: string;
  billingDay?: number;
  rentAmountMinor?: bigint;
}

/**
 * Creates rows a test needs and tears them down again, in the reverse of the
 * order they were created — the schema has no cascading deletes (DM: records
 * are voided, never hidden, so nothing was built to cascade), and every
 * factory here creates a child only after its parent exists, so unwinding in
 * reverse is always FK-safe (IG §8.3's "cascade-safe cleanup").
 *
 * `auth.ts`'s user/role fixtures register their own cleanup on the same
 * context via `track()`, so one `ctx.cleanup()` unwinds everything a test
 * created regardless of which factory module created it.
 */
export class TestContext {
  readonly #db: Writer;
  readonly #cleanups: Array<() => Promise<void>> = [];

  constructor(db: Writer) {
    this.#db = db;
  }

  track(cleanup: () => Promise<void>): void {
    this.#cleanups.push(cleanup);
  }

  async createBusiness(overrides: BusinessOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO business (id, name, currency_code, timezone) VALUES ($1, $2, $3, $4)`,
      [
        id,
        overrides.name ?? "Test Fleet",
        overrides.currencyCode ?? "LKR",
        overrides.timezone ?? "Asia/Colombo",
      ],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM business WHERE id = $1`, [id]);
    });
    return id;
  }

  async createOpenPeriod(businessId: string, overrides: OpenPeriodOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO accounting_period (id, business_id, period_start, period_end, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [id, businessId, overrides.periodStart ?? "2026-07-01", overrides.periodEnd ?? "2026-07-31"],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM accounting_period WHERE id = $1`, [id]);
    });
    return id;
  }

  async createVehicle(businessId: string, overrides: VehicleOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO vehicle (id, business_id, registration, vehicle_type) VALUES ($1, $2, $3, $4)`,
      [
        id,
        businessId,
        overrides.registration ?? `TEST-${id.slice(0, 8)}`,
        overrides.vehicleType ?? "car",
      ],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM vehicle WHERE id = $1`, [id]);
    });
    return id;
  }

  async createDriver(businessId: string, overrides: DriverOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO driver (id, business_id, name, driver_day_fee_minor) VALUES ($1, $2, $3, $4)`,
      [id, businessId, overrides.name ?? "Test Driver", overrides.dailyFeeMinor ?? 100_00n],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM driver WHERE id = $1`, [id]);
    });
    return id;
  }

  async createCustomer(businessId: string, overrides: CustomerOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO customer (id, business_id, customer_type, name, mobile) VALUES ($1, $2, 'person', $3, $4)`,
      [id, businessId, overrides.name ?? "Test Customer", overrides.mobile ?? "0770000000"],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM customer WHERE id = $1`, [id]);
    });
    return id;
  }

  async createLease(
    businessId: string,
    vehicleId: string,
    customerId: string,
    overrides: LeaseOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.query(
      `INSERT INTO lease (id, business_id, vehicle_id, customer_id, start_date, billing_day, rent_amount_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        businessId,
        vehicleId,
        customerId,
        overrides.startDate ?? "2026-07-01",
        overrides.billingDay ?? 1,
        overrides.rentAmountMinor ?? 50_000_00n,
      ],
    );
    this.track(async () => {
      await this.#db.query(`DELETE FROM lease WHERE id = $1`, [id]);
    });
    return id;
  }

  /** Unwinds every tracked row, most-recently-created first. */
  async cleanup(): Promise<void> {
    for (const fn of this.#cleanups.reverse()) {
      await fn();
    }
    this.#cleanups.length = 0;
  }
}
