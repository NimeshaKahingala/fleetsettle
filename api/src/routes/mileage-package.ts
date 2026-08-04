import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  archiveMileagePackageHandler,
  createMileagePackageHandler,
  listMileagePackagesHandler,
} from "../handlers/mileage-package.js";
import {
  archiveMileagePackageRoute,
  createMileagePackageRoute,
  listMileagePackagesRoute,
} from "../route-defs/mileage-package.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const mileagePackage = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createMileagePackageRoute, createMileagePackageHandler)
  .openapi(listMileagePackagesRoute, listMileagePackagesHandler)
  .openapi(archiveMileagePackageRoute, archiveMileagePackageHandler);
