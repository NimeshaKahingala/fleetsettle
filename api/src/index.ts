import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "./types.js";
import { requestLogger } from "./middleware/logger.js";
import { dbMiddleware } from "./middleware/db.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { errorHandler } from "./errors/handler.js";
import { health } from "./routes/health.js";
import { ready } from "./routes/ready.js";
import { me } from "./routes/me.js";
import { probe } from "./routes/_probe.js";
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

mountDocs(app);

export default app;
