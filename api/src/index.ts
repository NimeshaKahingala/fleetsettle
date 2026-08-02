import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "./types.js";
import { requestLogger } from "./middleware/logger.js";
import { dbMiddleware } from "./middleware/db.js";
import { authMiddleware, verifyTokenMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { errorHandler } from "./errors/handler.js";
import { health } from "./routes/health.js";
import { ready } from "./routes/ready.js";
import { me } from "./routes/me.js";
import { probe } from "./routes/_probe.js";
import { business } from "./routes/business.js";
import { vehicle } from "./routes/vehicle.js";
import { driver } from "./routes/driver.js";
import { customer } from "./routes/customer.js";
import { lease } from "./routes/lease.js";
import { dailyLease } from "./routes/dailyLease.js";
import { dayRecord } from "./routes/day-record.js";
import { trip } from "./routes/trip.js";
import { openingBalance } from "./routes/opening-balance.js";
import { expense } from "./routes/expense.js";
import { adjustment } from "./routes/adjustment.js";
import { advance } from "./routes/advance.js";
import { deposit } from "./routes/deposit.js";
import { offset } from "./routes/offset.js";
import { mileageAssessment } from "./routes/mileage-assessment.js";
import { payment } from "./routes/payment.js";
import {
  bankingEvent,
  capitalContribution,
  managementFeeAgreement,
  ownershipShare,
  partnerPayout,
} from "./routes/partner.js";
import { incident } from "./routes/incident.js";
import { auditLogRoutes } from "./routes/audit-log.js";
import { accountingPeriodRoutes } from "./routes/accounting-period.js";
import { mountDocs } from "./routes/docs.js";

const app = new OpenAPIHono<Env>();

app.use("*", requestLogger());
app.use("*", rateLimitMiddleware());
app.onError(errorHandler);

app.route("/api/health", health);

app.use("/api/ready", dbMiddleware());
app.route("/api/ready", ready);

// Auth needs the reader (queries/identity.ts), so db middleware runs first.
app.use("/api/me", dbMiddleware(), authMiddleware());
app.route("/api/me", me);

app.use("/api/_probe/*", dbMiddleware(), authMiddleware());
app.route("/api/_probe", probe);

// F-0.1: `verifyTokenMiddleware`, never `authMiddleware` — this route is
// what creates the first business_member row for an identity, so there is
// nothing yet for authMiddleware's resolveMembership to resolve.
app.use("/api/business", dbMiddleware(), verifyTokenMiddleware());
app.route("/api/business", business);

app.use("/api/vehicle/*", dbMiddleware(), authMiddleware());
app.route("/api/vehicle", vehicle);

app.use("/api/driver/*", dbMiddleware(), authMiddleware());
app.route("/api/driver", driver);

app.use("/api/customer/*", dbMiddleware(), authMiddleware());
app.route("/api/customer", customer);

app.use("/api/lease/*", dbMiddleware(), authMiddleware());
app.route("/api/lease", lease);

app.use("/api/daily-lease/*", dbMiddleware(), authMiddleware());
app.route("/api/daily-lease", dailyLease);

app.use("/api/trip/*", dbMiddleware(), authMiddleware());
app.route("/api/trip", trip);

app.use("/api/day-record/*", dbMiddleware(), authMiddleware());
app.route("/api/day-record", dayRecord);

app.use("/api/opening-balance/*", dbMiddleware(), authMiddleware());
app.route("/api/opening-balance", openingBalance);

app.use("/api/expense/*", dbMiddleware(), authMiddleware());
app.route("/api/expense", expense);

app.use("/api/adjustment/*", dbMiddleware(), authMiddleware());
app.route("/api/adjustment", adjustment);

app.use("/api/advance/*", dbMiddleware(), authMiddleware());
app.route("/api/advance", advance);

app.use("/api/deposit/*", dbMiddleware(), authMiddleware());
app.route("/api/deposit", deposit);

app.use("/api/offset/*", dbMiddleware(), authMiddleware());
app.route("/api/offset", offset);

app.use("/api/mileage-assessment/*", dbMiddleware(), authMiddleware());
app.route("/api/mileage-assessment", mileageAssessment);

app.use("/api/payment/*", dbMiddleware(), authMiddleware());
app.route("/api/payment", payment);

app.use("/api/ownership-share/*", dbMiddleware(), authMiddleware());
app.route("/api/ownership-share", ownershipShare);

app.use("/api/capital-contribution/*", dbMiddleware(), authMiddleware());
app.route("/api/capital-contribution", capitalContribution);

app.use("/api/management-fee-agreement/*", dbMiddleware(), authMiddleware());
app.route("/api/management-fee-agreement", managementFeeAgreement);

app.use("/api/banking-event/*", dbMiddleware(), authMiddleware());
app.route("/api/banking-event", bankingEvent);

app.use("/api/partner-payout/*", dbMiddleware(), authMiddleware());
app.route("/api/partner-payout", partnerPayout);

app.use("/api/incident/*", dbMiddleware(), authMiddleware());
app.route("/api/incident", incident);

app.use("/api/audit-log/*", dbMiddleware(), authMiddleware());
app.route("/api/audit-log", auditLogRoutes);

app.use("/api/accounting-period/*", dbMiddleware(), authMiddleware());
app.route("/api/accounting-period", accountingPeriodRoutes);

mountDocs(app);

export default app;
