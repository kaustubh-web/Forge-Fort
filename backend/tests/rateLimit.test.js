import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import app from "../src/app.js";
import { createLimiter } from "../src/middleware/rateLimit.js";

// A tiny app with a limit of 2, so the 429 can be reached without hundreds of requests.
// The fake auth middleware stands in for requireAuth: the user comes from a header.
function limitedApp(options) {
    const small = express();
    small.use((req, res, next) => {
        req.user = { _id: req.get("x-user") ?? "anonymous" };
        next();
    });
    small.get("/", createLimiter({ windowMs: 60_000, limit: 2, message: "Slow down", ...options }), (req, res) => res.json({ ok: true }));
    return small;
}

describe("createLimiter", () => {
    it("answers the third request with a 429 in the API envelope", async () => {
        const small = limitedApp();
        await request(small).get("/").expect(200);
        const second = await request(small).get("/").expect(200);
        expect(second.headers["ratelimit"]).toMatch(/remaining=0/);

        const third = await request(small).get("/").expect(429);
        expect(third.body).toEqual({ success: false, error: { code: "RATE_LIMITED", message: "Slow down", details: null } });
    });

    it("keyed by user, one user's limit does not block another (same IP)", async () => {
        const small = limitedApp({ keyGenerator: (req) => req.user._id });
        for (let i = 0; i < 2; i++) await request(small).get("/").set("x-user", "alice").expect(200);
        await request(small).get("/").set("x-user", "alice").expect(429);
        await request(small).get("/").set("x-user", "bob").expect(200);
    });
});

describe("limiters on the real routes", () => {
    it("every /api route reports the API limit (per 15 min), even before auth", async () => {
        const res = await request(app).get("/api/workflows").expect(401);
        expect(res.headers["ratelimit-policy"]).toBe("100000;w=900"); // API_RATE_LIMIT in tests/setup.js
    });

    it("the health check is not limited (hosting platforms poll it constantly)", async () => {
        const res = await request(app).get("/api/health").expect(200);
        expect(res.headers["ratelimit-policy"]).toBeUndefined();
    });

    it("execute reports the per-user run limit (per minute)", async () => {
        const reg = await request(app).post("/api/auth/register").send({ email: "limits@test.com", password: "password123" });
        const auth = `Bearer ${reg.body.data.token}`;
        // A missing workflow is a 404 from the controller, but the limiter has already counted it.
        const res = await request(app)
            .post("/api/workflows/64b000000000000000000000/execute")
            .set("Authorization", auth)
            .send({ input: {} });
        expect(res.status).toBe(404);
        expect(res.headers["ratelimit-policy"]).toBe("1000;w=60"); // EXECUTE_RATE_LIMIT in tests/setup.js
    });
});
