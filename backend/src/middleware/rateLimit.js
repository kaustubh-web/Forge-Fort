import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

// One factory so every limiter answers with the same 429 envelope and standard RateLimit headers.
// The counters live in this process's memory (single-instance limitation, like the run map).
export function createLimiter({ windowMs, limit, message, keyGenerator }) {
    return rateLimit({
        windowMs,
        limit,
        keyGenerator, // undefined = the library's default: the client IP (IPv6 grouped by /56)
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                error: { code: "RATE_LIMITED", message, details: null },
            });
        },
    });
}

// Login and register, per IP: slows down password guessing.
export const authLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT,
    message: "Too many attempts, try again later",
});

// Every /api request, per IP: a ceiling against scripts hammering the API.
export const apiLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: env.API_RATE_LIMIT,
    message: "Too many requests, try again later",
});

// Starting runs, per user (mounted after requireAuth). Each run makes real HTTP and AI calls,
// so it gets a much tighter limit, and keying by user means one account cannot dodge it by
// switching IPs or block other users behind the same office NAT.
export const executeLimiter = createLimiter({
    windowMs: 60 * 1000,
    limit: env.EXECUTE_RATE_LIMIT,
    message: "Too many runs started, wait a minute",
    keyGenerator: (req) => req.user._id.toString(),
});
