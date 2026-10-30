import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes  from "./routes/authRoutes.js";
import workflowRoutes from "./routes/workflowRoutes.js";
import executionRoutes from "./routes/executionRoutes.js";
const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN}));
// 50 nodes with long prompts or bodies can exceed 100kb, so allow a bit more.
// The Zod schema enforces the real per-field limits.
app.use(express.json({ limit :"512kb" }));


app.get("/api/health",(req,res)=>{
    res.json({ success: true, data: {status: "ok"}})
});

app.use("/api/auth",authRoutes);
app.use("/api/workflows",workflowRoutes);
app.use("/api/executions",executionRoutes);

app.use(notFound);

app.use(errorHandler);

export default app;
