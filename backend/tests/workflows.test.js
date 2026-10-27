import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";

// Registers a fresh user and returns the Authorization header value for them
let counter = 0;
async function newUser() {
    counter += 1;
    const res = await request(app)
        .post("/api/auth/register")
        .send({ email: `user${counter}@test.com`, password: "password123" });
    return `Bearer ${res.body.data.token}`;
}

// trigger -> condition -(true)-> output
//                      -(false)-> output
function validWorkflow(overrides = {}) {
    return {
        name: "My workflow",
        description: "demo",
        nodes: [
            { id: "trigger-1", type: "manualTrigger", position: { x: 0, y: 0 }, data: { label: "Start", config: {} } },
            {
                id: "cond-1",
                type: "condition",
                position: { x: 200, y: 0 },
                data: { label: "Check", config: { left: "{{nodes.trigger-1.output.n}}", operator: "greaterThan", right: "5" } },
            },
            { id: "out-yes", type: "output", position: { x: 400, y: -50 }, data: { label: "Yes", config: { message: "big" } } },
            { id: "out-no", type: "output", position: { x: 400, y: 50 }, data: { label: "No", config: { message: "small" } } },
        ],
        edges: [
            { id: "e1", source: "trigger-1", target: "cond-1", sourceHandle: null },
            { id: "e2", source: "cond-1", target: "out-yes", sourceHandle: "true" },
            { id: "e3", source: "cond-1", target: "out-no", sourceHandle: "false" },
        ],
        ...overrides,
    };
}

const create = (auth, body = validWorkflow()) =>
    request(app).post("/api/workflows").set("Authorization", auth).send(body);

describe("auth is required", () => {
    it("rejects every workflow route without a token", async () => {
        const calls = [
            request(app).get("/api/workflows"),
            request(app).post("/api/workflows").send(validWorkflow()),
            request(app).get("/api/workflows/507f1f77bcf86cd799439011"),
            request(app).put("/api/workflows/507f1f77bcf86cd799439011").send(validWorkflow()),
            request(app).delete("/api/workflows/507f1f77bcf86cd799439011"),
            request(app).post("/api/workflows/507f1f77bcf86cd799439011/duplicate"),
        ];
        for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    });
});

describe("create and read", () => {
    it("creates a workflow and returns it with the owner set", async () => {
        const auth = await newUser();
        const res = await create(auth);

        expect(res.status).toBe(201);
        expect(res.body.data.workflow.name).toBe("My workflow");
        expect(res.body.data.workflow.nodes).toHaveLength(4);
        expect(res.body.data.workflow.owner).toEqual(expect.any(String));
        expect(res.body.data.workflow.__v).toBeUndefined();
    });

    it("loads exactly what was saved (round trip)", async () => {
        const auth = await newUser();
        const { body } = await create(auth);
        const id = body.data.workflow._id;

        const res = await request(app).get(`/api/workflows/${id}`).set("Authorization", auth);

        expect(res.status).toBe(200);
        expect(res.body.data.workflow.nodes.map((n) => n.id)).toEqual(["trigger-1", "cond-1", "out-yes", "out-no"]);
        expect(res.body.data.workflow.edges[1]).toMatchObject({ source: "cond-1", sourceHandle: "true" });
    });

    it("lists only summaries, newest first", async () => {
        const auth = await newUser();
        await create(auth, validWorkflow({ name: "first" }));
        await create(auth, validWorkflow({ name: "second" }));

        const res = await request(app).get("/api/workflows").set("Authorization", auth);

        expect(res.status).toBe(200);
        expect(res.body.data.workflows.map((w) => w.name)).toEqual(["second", "first"]);
        expect(res.body.data.workflows[0].nodes).toBeUndefined();
    });

    it("strips unknown fields and keeps only known config", async () => {
        const auth = await newUser();
        const body = validWorkflow();
        body.nodes[0].data.config = { evil: "x".repeat(10) };
        body.nodes[0].extra = "nope";
        const res = await create(auth, body);

        expect(res.status).toBe(201);
        expect(res.body.data.workflow.nodes[0].extra).toBeUndefined();
        expect(res.body.data.workflow.nodes[0].data.config).toEqual({});
    });
});

describe("update, duplicate, delete", () => {
    it("replaces the workflow on PUT", async () => {
        const auth = await newUser();
        const { body } = await create(auth);
        const id = body.data.workflow._id;

        const next = validWorkflow({ name: "Renamed", nodes: [validWorkflow().nodes[0]], edges: [] });
        const res = await request(app).put(`/api/workflows/${id}`).set("Authorization", auth).send(next);

        expect(res.status).toBe(200);
        expect(res.body.data.workflow.name).toBe("Renamed");
        expect(res.body.data.workflow.nodes).toHaveLength(1);
        expect(res.body.data.workflow.edges).toHaveLength(0);
    });

    it("duplicates a workflow with a copy suffix", async () => {
        const auth = await newUser();
        const { body } = await create(auth);

        const res = await request(app)
            .post(`/api/workflows/${body.data.workflow._id}/duplicate`)
            .set("Authorization", auth);

        expect(res.status).toBe(201);
        expect(res.body.data.workflow.name).toBe("My workflow (copy)");
        expect(res.body.data.workflow._id).not.toBe(body.data.workflow._id);
        expect(res.body.data.workflow.nodes).toHaveLength(4);
    });

    it("deletes a workflow", async () => {
        const auth = await newUser();
        const { body } = await create(auth);
        const id = body.data.workflow._id;

        const del = await request(app).delete(`/api/workflows/${id}`).set("Authorization", auth);
        const after = await request(app).get(`/api/workflows/${id}`).set("Authorization", auth);

        expect(del.status).toBe(200);
        expect(after.status).toBe(404);
    });
});

describe("ownership", () => {
    it("returns 404 (not 403) for another user's workflow on every route", async () => {
        const alice = await newUser();
        const bob = await newUser();
        const { body } = await create(alice);
        const id = body.data.workflow._id;

        const attempts = [
            request(app).get(`/api/workflows/${id}`).set("Authorization", bob),
            request(app).put(`/api/workflows/${id}`).set("Authorization", bob).send(validWorkflow()),
            request(app).delete(`/api/workflows/${id}`).set("Authorization", bob),
            request(app).post(`/api/workflows/${id}/duplicate`).set("Authorization", bob),
        ];
        for (const res of await Promise.all(attempts)) {
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
        }

        // and it is still there for Alice
        const still = await request(app).get(`/api/workflows/${id}`).set("Authorization", alice);
        expect(still.status).toBe(200);
    });

    it("does not list another user's workflows", async () => {
        const alice = await newUser();
        const bob = await newUser();
        await create(alice);

        const res = await request(app).get("/api/workflows").set("Authorization", bob);
        expect(res.body.data.workflows).toEqual([]);
    });

    it("returns 404 for a malformed id", async () => {
        const auth = await newUser();
        const res = await request(app).get("/api/workflows/not-an-id").set("Authorization", auth);
        expect(res.status).toBe(404);
    });
});

describe("validation rejects bad workflows with 400", () => {
    async function expectInvalid(mutate, field) {
        const auth = await newUser();
        const body = validWorkflow();
        mutate(body);
        const res = await create(auth, body);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        if (field) expect(res.body.error.details.some((d) => d.field.startsWith(field))).toBe(true);
    }

    it("missing name", () => expectInvalid((b) => (b.name = "  "), "name"));
    it("unknown node type", () => expectInvalid((b) => (b.nodes[0].type = "shellCommand"), "nodes"));
    it("invalid config value for the node type", () =>
        expectInvalid((b) => (b.nodes[1].data.config.operator = "runCode"), "nodes.1.data.config.operator"));
    it("node id with a dot", () => expectInvalid((b) => (b.nodes[0].id = "a.b"), "nodes.0.id"));
    it("duplicate node ids", () => expectInvalid((b) => (b.nodes[3].id = "out-yes"), "nodes.3.id"));
    it("edge to a node that does not exist", () => expectInvalid((b) => (b.edges[0].target = "ghost"), "edges.0.target"));
    it("edge from a node that does not exist", () => expectInvalid((b) => (b.edges[0].source = "ghost"), "edges.0.source"));
    it("self loop", () => expectInvalid((b) => (b.edges[0] = { id: "e1", source: "cond-1", target: "cond-1", sourceHandle: "true" })));
    it("condition edge without a handle", () => expectInvalid((b) => (b.edges[1].sourceHandle = null), "edges.1.sourceHandle"));
    it("true/false handle on a non-condition node", () =>
        expectInvalid((b) => (b.edges[0].sourceHandle = "true"), "edges.0.sourceHandle"));
    it("duplicate connection", () => expectInvalid((b) => b.edges.push({ ...b.edges[1], id: "e9" })));
    it("too many nodes", () =>
        expectInvalid((b) => {
            b.nodes = Array.from({ length: 51 }, (_, i) => ({
                id: `n${i}`,
                type: "output",
                position: { x: 0, y: 0 },
                data: { label: "", config: {} },
            }));
            b.edges = [];
        }, "nodes"));
    it("HTTP retry above the limit of 5", () =>
        expectInvalid((b) => {
            b.nodes[0] = {
                id: "http-1",
                type: "httpRequest",
                position: { x: 0, y: 0 },
                data: { label: "", config: { retry: { maxAttempts: 9, backoffMs: 100 } } },
            };
            b.edges = [];
        }, "nodes.0.data.config.retry"));

    it("the same checks apply on update", async () => {
        const auth = await newUser();
        const { body } = await create(auth);
        const bad = validWorkflow();
        bad.edges[0].target = "ghost";

        const res = await request(app)
            .put(`/api/workflows/${body.data.workflow._id}`)
            .set("Authorization", auth)
            .send(bad);
        expect(res.status).toBe(400);
    });
});
