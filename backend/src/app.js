import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN}));
app.use(express.json({ limit :"100kb" }));


app.get("/api/health",(req,res)=>{
    res.json({ success: true, data: {status: "ok"}})
});

app.use(notFound);
app.use(errorHandler);

export default app;
