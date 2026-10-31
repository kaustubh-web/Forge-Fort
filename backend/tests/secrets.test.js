import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { Secret } from "../src/models/Secret.js";
import { loadSecrets } from "../src/services/secretService.js";

let counter = 0;
async function newUser() {
    counter += 1;
    const res = await request(app).post("/api/auth/register").send({ email: `secret${counter}@test.com`, password: "password123" });
    return { auth: `Bearer ${res.body.data.token}`, id: res.body.data.user._id };
}
const api = (method, path, auth) => request(app)[method](`/api/secrets${path}`).set("Authorization", auth);

describe("/api/secrets", () => {
    it("creates, lists, rotates and deletes, and never returns the value", async () => {
        const { auth } = await newUser();

        const created = await api("post", "", auth).send({ name: "GITHUB_TOKEN", value: "ghp_abc123456" });
        expect(created.status).toBe(201);
        expect(created.body.data.secret).toMatchObject({ name: "GITHUB_TOKEN" });
        expect(JSON.stringify(created.body)).not.toContain("ghp_abc");
        expect(created.body.data.secret.value).toBeUndefined();

        await api("post", "", auth).send({ name: "API_KEY", value: "k-999999" });
        const list = await api("get", "", auth);
        expect(list.body.data.secrets.map((s) => s.name)).toEqual(["API_KEY", "GITHUB_TOKEN"]);
        expect(JSON.stringify(list.body)).not.toMatch(/ghp_abc|k-999999|v1\./);

        const rotated = await api("put", "/GITHUB_TOKEN", auth).send({ value: "ghp_new7777777" });
        expect(rotated.status).toBe(200);
        expect(JSON.stringify(rotated.body)).not.toContain("ghp_new");

        expect((await api("delete", "/API_KEY", auth)).status).toBe(200);
        expect((await api("delete", "/API_KEY", auth)).status).toBe(404);
        expect((await api("get", "", auth)).body.data.secrets).toHaveLength(1);
    });

    it("stores only ciphertext, bound to the owner", async () => {
        const { auth, id } = await newUser();
        await api("post", "", auth).send({ name: "TOKEN_A", value: "plain-value-42" });
        const stored = await Secret.findOne({ name: "TOKEN_A" }).select("+value").lean();
        expect(stored.value).toMatch(/^v1\./);
        expect(stored.value).not.toContain("plain-value-42");

        const { values, missing } = await loadSecrets(id, ["TOKEN_A", "NOPE"]);
        expect(values).toEqual({ TOKEN_A: "plain-value-42" });
        expect(missing).toEqual(["NOPE"]);
    });

    it("rejects a duplicate name with 409 and bad names or values with 400", async () => {
        const { auth } = await newUser();
        await api("post", "", auth).send({ name: "DUP", value: "v-1234" });
        const dup = await api("post", "", auth).send({ name: "DUP", value: "v-5678" });
        expect(dup.status).toBe(409);
        expect(dup.body.error.code).toBe("SECRET_EXISTS");

        for (const body of [
            { name: "lowercase", value: "x" },
            { name: "HAS.DOT", value: "x" },
            { name: "1STARTS_WITH_DIGIT", value: "x" },
            { name: "OK", value: "" },
            { name: "OK", value: "x".repeat(4097) },
        ]) {
            const res = await api("post", "", auth).send(body);
            expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
        }
    });

    it("keeps users apart: same name allowed for both, other user's secret is 404", async () => {
        const alice = await newUser();
        const bob = await newUser();
        await api("post", "", alice.auth).send({ name: "SHARED_NAME", value: "alice-value" });
        expect((await api("post", "", bob.auth).send({ name: "SHARED_NAME", value: "bob-value" })).status).toBe(201);

        await api("post", "", alice.auth).send({ name: "ALICE_ONLY", value: "alice-2222" });
        expect((await api("put", "/ALICE_ONLY", bob.auth).send({ value: "hijack" })).status).toBe(404);
        expect((await api("delete", "/ALICE_ONLY", bob.auth)).status).toBe(404);
        expect((await api("get", "", bob.auth)).body.data.secrets.map((s) => s.name)).toEqual(["SHARED_NAME"]);

        expect((await loadSecrets(alice.id, ["SHARED_NAME"])).values).toEqual({ SHARED_NAME: "alice-value" });
        expect((await loadSecrets(bob.id, ["SHARED_NAME"])).values).toEqual({ SHARED_NAME: "bob-value" });
    });

    it("requires a token", async () => {
        expect((await request(app).get("/api/secrets")).status).toBe(401);
    });
});
