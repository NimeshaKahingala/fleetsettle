import { swaggerUI } from "@hono/swagger-ui";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.js";
import { NotFoundError } from "../errors/app-error.js";

/**
 * The spec generates itself from the app's registered `createRoute()` defs
 * (IG §3.5) — there is nothing to hand-maintain here. Both the UI and the
 * spec 404 in production: a public spec advertises the whole API surface,
 * and CI asserts this 404 as a production smoke check (IG §10.7).
 */
export const mountDocs = (app: OpenAPIHono<Env>) => {
  const productionGate: MiddlewareHandler<Env> = async (c, next) => {
    if (c.env.ENVIRONMENT === "production") throw new NotFoundError();
    await next();
  };

  app.use("/api/docs", productionGate);
  app.use("/api/docs/openapi.json", productionGate);

  app.doc31("/api/docs/openapi.json", {
    openapi: "3.1.0",
    info: { title: "FleetSettle API", version: "0.0.0" },
  });
  app.get("/api/docs", swaggerUI({ url: "/api/docs/openapi.json" }));
};
