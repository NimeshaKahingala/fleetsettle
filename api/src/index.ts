import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "./types.js";
import { requestLogger } from "./middleware/logger.js";
import { dbMiddleware } from "./middleware/db.js";
import { errorHandler } from "./errors/handler.js";
import { health } from "./routes/health.js";
import { ready } from "./routes/ready.js";
import { mountDocs } from "./routes/docs.js";

const app = new OpenAPIHono<Env>();

app.use("*", requestLogger());
app.onError(errorHandler);

app.route("/api/health", health);

app.use("/api/ready", dbMiddleware());
app.route("/api/ready", ready);

mountDocs(app);

export default app;
