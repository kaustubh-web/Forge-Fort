import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { WorkflowExecution } from "../src/models/WorkflowExecution.js";
import { nodeRegistry } from "../src/nodes/registry.js";
import { NodeError } from "../src/engine/errors.js";
import { parsePath } from "../src/engine/expressions.js";
import { createValueRedactor, REDACTED } from "../src/utils/redact.js";

const TOKEN = "tok_live_9f8e7d6c5b4a";

const realHttpExecute = nodeRegistry.httpRequest.execute;
afterEach(() => {
    nodeRegistry.httpRequest.execute = realHttpExecute;
});

let counter = 0;
async function newUser() {
    counter += 1;
    const res = await request(app).post("/api/auth/register").send({ email: `srun${counter}@test.com`, password: "password123" });
    return `Bearer ${res.body.data.token}`;
}

const n = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, config } });
const e = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: null });

function workflowUsing(httpConfig, outMessage = "done") {
    return {
        name: "Uses a secret",
        description: "",
        nodes: [
            n("trigger-1", "manualTrigger", {}),
            n("http", "httpRequest", { method: "GET", retry: { maxAttempts: 1, backoffMs: 0 }, ...httpConfig }),
            n("out", "output", { message: outMessage }),
        ],
        edges: [e("trigger-1", "http"), e("http", "out")],
    };
}

async function setup(auth, wf, secrets = { API_TOKEN: TOKEN }) {
    for (const [name, value] of Object.entries(secrets)) {
        await request(app).post("/api/secrets").set("Authorization", auth).send({ name, value });
    }
    const res = await request(app).post("/api/workflows").set("Authorization", auth).send(wf);
    expect(res.status).toBe(201);
    return res.body.data.workflow._id;
}

const execute = (auth, id) => request(app).post(`/api/workflows/${id}/execute`).set("Authorization", auth).send({ input: {} });

async function finished(auth, id) {
    for (let i = 0; i < 200; i++) {
        const execution = (await request(app).get(`/api/executions/${id}`).set("Authorization", auth)).body.data.execution;
        if (execution.status !== "running") return execution;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("run did not finish");
}

describe("{{secrets.NAME}} in a run", () => {
    it("the HTTP call gets the real value; nothing stored or returned contains it", async () => {
        let seen;
        // Like a careless API: echoes the request back, token included.
        nodeRegistry.httpRequest.execute = ({ config }) => {
            seen = config;
            return { output: { status: 200, headers: {}, body: { echoedAuth: config.headers[0].value, url: config.url } } };
        };
        const auth = await newUser();
        const id = await setup(
            auth,
            workflowUsing(
                {
                    url: "https://api.example.com/items?key={{secrets.API_TOKEN}}",
                    headers: [{ key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" }],
                },
                "Got {{nodes.http.output.body.echoedAuth}}"
            )
        );

        const res = await execute(auth, id);
        expect(res.status).toBe(202);
        const execution = await finished(auth, res.body.data.executionId);

        expect(execution.status).toBe("completed");
        expect(seen.headers[0].value).toBe(`Bearer ${TOKEN}`); // the engine resolved it
        expect(seen.url).toContain(TOKEN);

        const stored = JSON.stringify(await WorkflowExecution.findById(res.body.data.executionId).lean());
        expect(stored).not.toContain(TOKEN);
        expect(JSON.stringify(execution)).not.toContain(TOKEN);
        const http = execution.nodes.find((r) => r.nodeId === "http");
        expect(http.output.body.echoedAuth).toBe(`Bearer ${REDACTED}`);
        expect(execution.outputs.out.message).toBe(`Got Bearer ${REDACTED}`);

        // The workflow JSON itself holds only the reference.
        const wf = (await request(app).get(`/api/workflows/${id}`).set("Authorization", auth)).body.data.workflow;
        expect(JSON.stringify(wf)).not.toContain(TOKEN);
        expect(JSON.stringify(wf)).toContain("{{secrets.API_TOKEN}}");
    });

    it("an error message quoting the secret (even URL-encoded) is redacted", async () => {
        nodeRegistry.httpRequest.execute = ({ config }) => {
            throw new NodeError(`Request to ${config.url} failed`);
        };
        const auth = await newUser();
        const encodedToken = "a b/c+d&e=f";
        const id = await setup(auth, workflowUsing({ url: "https://api.example.com/?k={{secrets.ODD_TOKEN}}" }), { ODD_TOKEN: encodedToken });
        // The fake throws with the raw URL; simulate what a real client shows: the encoded form too.
        nodeRegistry.httpRequest.execute = ({ config }) => {
            throw new NodeError(`Request to ${config.url} failed (sent ${encodeURIComponent(encodedToken)})`);
        };
        const res = await execute(auth, id);
        const execution = await finished(auth, res.body.data.executionId);

        expect(execution.status).toBe("failed");
        const stored = JSON.stringify(await WorkflowExecution.findById(res.body.data.executionId).lean());
        expect(stored).not.toContain(encodedToken);
        expect(stored).not.toContain(encodeURIComponent(encodedToken));
        expect(execution.error.message).toBe(`Request to https://api.example.com/?k=${REDACTED} failed (sent ${REDACTED})`);
    });

    it("a missing secret is a 400 before anything runs", async () => {
        const auth = await newUser();
        const id = await setup(auth, workflowUsing({ url: "https://x.test/", headers: [{ key: "X-Api-Key", value: "{{secrets.NOT_SAVED}}" }] }), {});
        const res = await execute(auth, id);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([{ nodeId: null, message: "Secret NOT_SAVED does not exist. Add it under Settings > Secrets" }]);
        expect(await WorkflowExecution.countDocuments({ workflow: id })).toBe(0);
    });

    it("secrets are refused outside HTTP Request nodes", async () => {
        const auth = await newUser();
        const id = await setup(auth, workflowUsing({ url: "https://x.test/" }, "Leaking {{secrets.API_TOKEN}}"));
        const res = await execute(auth, id);
        expect(res.status).toBe(400);
        expect(res.body.error.details.map((d) => d.message)).toContain('Node "out": {{secrets...}} can only be used in HTTP Request nodes');
    });

    it("another user's secret with the same name is not used", async () => {
        let seen;
        nodeRegistry.httpRequest.execute = ({ config }) => {
            seen = config.headers[0].value;
            return { output: { status: 200, headers: {}, body: {} } };
        };
        const alice = await newUser();
        await request(app).post("/api/secrets").set("Authorization", alice).send({ name: "API_TOKEN", value: "alice-only-value" });
        const bob = await newUser();
        const id = await setup(bob, workflowUsing({ url: "https://x.test/", headers: [{ key: "Authorization", value: "{{secrets.API_TOKEN}}" }] }), { API_TOKEN: "bob-own-value" });
        await finished(bob, (await execute(bob, id)).body.data.executionId);
        expect(seen).toBe("bob-own-value");
    });
});

describe("secrets expression syntax", () => {
    it("accepts exactly {{secrets.NAME}}", () => {
        expect(parsePath("secrets.API_TOKEN")).toEqual({ root: "secrets", name: "API_TOKEN", keys: [] });
        for (const bad of ["secrets", "secrets.lower", "secrets.A.b", "secrets.1X"]) {
            expect(parsePath(bad).error, bad).toMatch(/must look like \{\{secrets\.NAME\}\}/);
        }
    });
});

describe("createValueRedactor", () => {
    it("masks values anywhere in strings and keys, longest first, and ignores very short values", () => {
        const hide = createValueRedactor(["abcd", "abcdef", "xy", 42]);
        expect(hide({ "k-abcdef": ["see abcdef and abcd", 5, null], note: "xy stays" })).toEqual({
            [`k-${REDACTED}`]: [`see ${REDACTED} and ${REDACTED}`, 5, null],
            note: "xy stays",
        });
        expect(createValueRedactor([])("anything")).toBe("anything");
    });
});
