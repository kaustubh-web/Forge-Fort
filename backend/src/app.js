import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes  from "./routes/authRoutes.js";
import workflowRoutes from "./routes/workflowRoutes.js";
import executionRoutes from "./routes/executionRoutes.js";
import secretRoutes from "./routes/secretRoutes.js";
import { apiLimiter } from "./middleware/rateLimit.js";
const app = express();

// Behind a hosting proxy, req.ip would otherwise be the proxy's address for every user.
// A hop count (not "true") so a client cannot fake its IP with its own X-Forwarded-For header.
app.set("trust proxy", env.TRUST_PROXY);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN}));
// 50 nodes with long prompts or bodies can exceed 100kb, so allow a bit more.
// The Zod schema enforces the real per-field limits.
app.use(express.json({ limit :"512kb" }));


// Registered before the API limiter on purpose: hosting platforms poll it every few seconds.
app.get("/api/health",(req,res)=>{
    res.json({ success: true, data: {status: "ok"}})
});

app.use("/api", apiLimiter);
app.use("/api/auth",authRoutes);
app.use("/api/workflows",workflowRoutes);
app.use("/api/executions",executionRoutes);
app.use("/api/secrets", secretRoutes);

app.use(notFound);

app.use(errorHandler);

export default app;
