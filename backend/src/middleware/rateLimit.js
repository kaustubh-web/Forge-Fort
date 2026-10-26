import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const authLimiter = rateLimit({
    windowMs: 15*60*1000,
    limit: env.AUTH_RATE_LIMIT,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req,res)=>{
        res.status(429).json({
            success: false,
            error: {code:"RATE_LIMITED",message: "Too many attempts, try again later",details: null},
        });
    },
});