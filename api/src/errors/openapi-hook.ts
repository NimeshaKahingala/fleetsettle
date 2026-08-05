import type { z } from "zod";
import { ValidationError } from "./app-error.js";

type HookResult = { success: true; data: unknown } | { success: false; error: z.ZodError };

/**
 * `OpenAPIHono`'s `defaultHook` (IG §3.3): a route-def failing its own Zod
 * validation throws the same `ValidationError` every hand-rolled 400 does,
 * rather than `@hono/zod-openapi`'s own default body shape — one error shape
 * on the wire regardless of which layer produced it.
 */
export function zodValidationHook(result: HookResult): void {
  if (!result.success) {
    throw new ValidationError("Request failed validation", result.error.flatten());
  }
}
