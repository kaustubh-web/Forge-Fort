import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";

// The JSON body parser (express.json, limit 512 KB) rejects some requests before any route runs.
// Those are the client's fault, so they must come back as 4xx in the normal error envelope.
describe("request body errors", () => {
    it("a body over the limit is 413, not 500", async () => {
        const big = { email: "a@b.com", password: "x".repeat(600 * 1024) };
        const res = await request(app).post("/api/auth/login").send(big);
        expect(res.status).toBe(413);
        expect(res.body).toEqual({
            success: false,
            error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is larger than 512 KB", details: null },
        });
    });

    it("an unsupported charset is 415", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .set("Content-Type", "application/json; charset=no-such-charset")
            .send('{"email":"a@b.com","password":"password123"}');
        expect(res.status).toBe(415);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("BAD_REQUEST_BODY");
    });

    it("invalid JSON is still 400 INVALID_JSON", async () => {
        const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{nope");
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_JSON");
    });
});
