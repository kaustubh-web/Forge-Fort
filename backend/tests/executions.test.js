import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { WorkflowExecution } from "../src/models/WorkflowExecution.js";
import { markInterruptedExecutions } from "../src/services/executionService.js";
import { nodeRegistry } from "../src/nodes/registry.js";
import { NodeError } from "../src/engine/errors.js";
import { REDACTED } from "../src/utils/redact.js";

// The HTTP node's handler is replaced by a fake where a test needs one: no real network.
const realHttpExecute = nodeRegistry.httpRequest.execute;
afterEach(() => {
    nodeRegistry.httpRequest.execute = realHttpExecute;
});

let counter = 0;
async function newUser() {
    counter += 1;
    const res = await request(app)
        .post("/api/auth/register")
        .send({ email: `exec${counter}@test.com`, password: "password123" });
    return `Bearer ${res.body.data.token}`;
}

const n = (id, type, config, x = 0) => ({ id, type, position: { x, y: 0 }, data: { label: id, config } });
const e = (source, target, sourceHandle = null) => ({ id: `${source}-${target}`, source, target, sourceHandle });

// trigger -> condition(n > 5) -(true)-> big / -(false)-> small
const branching = {
    name: "Branching",
    description: "",
    nodes: [
        n("trigger-1", "manualTrigger", {}),
        n("check", "condition", { left: "{{input.n}}", operator: "greaterThan", right: "5" }),
        n("big", "output", { message: "big {{input.n}}" }),
        n("small", "output", { message: "small {{input.n}}" }),
    ],
    edges: [e("trigger-1", "check"), e("check", "big", "true"), e("check", "small", "false")],
};

// trigger -> http -> output
const withHttp = {
    name: "With HTTP",
    description: "",
    nodes: [
        n("trigger-1", "manualTrigger", {}),
        n("http", "httpRequest", { method: "GET", url: "https://example.com", retry: { maxAttempts: 1, backoffMs: 0 } }),
        n("out", "output", { message: "done" }),
    ],
    edges: [e("trigger-1", "http"), e("http", "out")],
};

async function createWorkflow(auth, wf = branching) {
    const res = await request(app).post("/api/workflows").set("Authorization", auth).send(wf);
    return res.body.data.workflow._id;
}

const execute = (auth, workflowId, body) => {
    const req = request(app).post(`/api/workflows/${workflowId}/execute`).set("Authorization", auth);
    return body === undefined ? req : req.send(body);
};

const getExecution = (auth, id) => request(app).get(`/api/executions/${id}`).set("Authorization", auth);

// The run happens in the background after the 202, so poll the persisted record until it ends.
async function waitFor(auth, id, done = (x) => x.status !== "running") {
    for (let i = 0; i < 200; i++) {
        const execution = (await getExecution(auth, id)).body.data.execution;
        if (done(execution)) return execution;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`execution ${id} did not reach the expected state`);
}

const node = (execution, id) => execution.nodes.find((r) => r.nodeId === id);

describe("POST /api/workflows/:id/execute", () => {
    it("returns 202 at once and the persisted run completes in the background", async () => {
        const auth = await newUser();
        const workflowId = await createWorkflow(auth);

        const res = await execute(auth, workflowId, { input: { n: 10 } });
        expect(res.status).toBe(202);
        expect(res.body.data).toEqual({ executionId: expect.any(String), status: "running" });

        const execution = await waitFor(auth, res.body.data.executionId);
        expect(execution).toMatchObject({
            status: "completed",
            workflow: workflowId,
            input: { n: 10 },
            error: null,
            metadata: { workflowName: "Branching" },
            outputs: { big: { message: "big 10", data: {} } },
        });
        expect(execution.nodes.map((r) => [r.nodeId, r.status])).toEqual([
            ["trigger-1", "success"],
            ["check", "success"],
            ["big", "success"],
            ["small", "skipped"],
        ]);
        expect(node(execution, "check").branch).toBe("true");
        expect(node(execution, "small").skipReason).toBe("Condition 'check' took the true branch");
        expect(execution.logs.map((l) => l.message)).toEqual(["big 10"]);
        expect(execution.durationMs).toBeTypeOf("number");
    });

    it("treats a missing body as empty input", async () => {
        const auth = await newUser();
        const res = await execute(auth, await createWorkflow(auth));
        expect(res.status).toBe(202);
        const execution = await waitFor(auth, res.body.data.executionId);
        expect(execution.input).toEqual({});
    });

    it("rejects input that is not a JSON object, or too large", async () => {
        const auth = await newUser();
        const workflowId = await createWorkflow(auth);
        for (const input of [[1, 2], "text", { big: "x".repeat(100_001) }]) {
            const res = await execute(auth, workflowId, { input });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("VALIDATION_ERROR");
        }
        expect(await WorkflowExecution.countDocuments()).toBe(0);
    });

    it("rejects a graph that cannot run with 400 and creates no execution", async () => {
        const auth = await newUser();
        // Saving allows drafts; running does not (no trigger here).
        const workflowId = await createWorkflow(auth, { name: "Draft", nodes: [n("out", "output", { message: "x" })], edges: [] });
        const res = await execute(auth, workflowId, { input: {} });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_WORKFLOW");
        expect(await WorkflowExecution.countDocuments()).toBe(0);
    });

    it("keeps partial results when a node fails", async () => {
        nodeRegistry.httpRequest.execute = async () => {
            throw new NodeError("HTTP 404 Not Found");
        };
        const auth = await newUser();
        const res = await execute(auth, await createWorkflow(auth, withHttp), { input: {} });
        const execution = await waitFor(auth, res.body.data.executionId);

        expect(execution.status).toBe("failed");
        expect(execution.error).toEqual({ nodeId: "http", message: "HTTP 404 Not Found" });
        expect(node(execution, "trigger-1").status).toBe("success");
        expect(node(execution, "http")).toMatchObject({ status: "failed", attempts: 1 });
        expect(node(execution, "out")).toMatchObject({ status: "skipped", skipReason: "upstream failed" });
    });

    it("stores the input with secrets redacted", async () => {
        const auth = await newUser();
        const res = await execute(auth, await createWorkflow(auth), { input: { n: 1, apiKey: "sk-123" } });
        const execution = await waitFor(auth, res.body.data.executionId);
        expect(execution.input).toEqual({ n: 1, apiKey: REDACTED });
        expect(node(execution, "trigger-1").output).toEqual({ n: 1, apiKey: REDACTED });
        expect(JSON.stringify(execution)).not.toContain("sk-123");
    });
});

describe("GET /api/workflows/:id/executions", () => {
    it("lists that workflow's runs newest first, as summaries", async () => {
        const auth = await newUser();
        const workflowId = await createWorkflow(auth);
        const other = await createWorkflow(auth);

        const first = await execute(auth, workflowId, { input: { n: 1 } });
        await waitFor(auth, first.body.data.executionId);
        const second = await execute(auth, workflowId, { input: { n: 9 } });
        await waitFor(auth, second.body.data.executionId);
        await waitFor(auth, (await execute(auth, other, {})).body.data.executionId);

        const res = await request(app).get(`/api/workflows/${workflowId}/executions`).set("Authorization", auth);
        expect(res.status).toBe(200);
        const { executions } = res.body.data;
        expect(executions.map((x) => x._id)).toEqual([second.body.data.executionId, first.body.data.executionId]);
        expect(executions[0]).toMatchObject({ status: "completed", input: { n: 9 }, metadata: { workflowName: "Branching" } });
        expect(executions[0].nodes).toBeUndefined(); // summaries only
    });
});

describe("POST /api/executions/:id/cancel", () => {
    it("stops a running node and the execution ends cancelled", async () => {
        // Like a real fetch: only ends when its signal aborts.
        nodeRegistry.httpRequest.execute = ({ signal }) =>
            new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        const auth = await newUser();
        const { executionId } = (await execute(auth, await createWorkflow(auth, withHttp), {})).body.data;
        await waitFor(auth, executionId, (x) => node(x, "http").status === "running");

        const res = await request(app).post(`/api/executions/${executionId}/cancel`).set("Authorization", auth);
        expect(res.status).toBe(202);
        expect(res.body.data).toEqual({ executionId, status: "cancelling" });

        const execution = await waitFor(auth, executionId);
        expect(execution.status).toBe("cancelled");
        expect(node(execution, "http")).toMatchObject({ status: "failed", error: "Cancelled" });
        expect(node(execution, "out")).toMatchObject({ status: "skipped", skipReason: "execution cancelled" });
    });

    it("returns 409 for an execution that already finished", async () => {
        const auth = await newUser();
        const { executionId } = (await execute(auth, await createWorkflow(auth), { input: { n: 1 } })).body.data;
        await waitFor(auth, executionId);
        const res = await request(app).post(`/api/executions/${executionId}/cancel`).set("Authorization", auth);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: "NOT_RUNNING", message: "Execution is already completed" });
    });

    it("finishes a 'running' record that no engine in this process is running", async () => {
        const auth = await newUser();
        const me = (await request(app).get("/api/auth/me").set("Authorization", auth)).body.data.user;
        const orphan = await WorkflowExecution.create({ workflow: new mongoose.Types.ObjectId(), owner: me._id ?? me.id });

        const res = await request(app).post(`/api/executions/${orphan._id}/cancel`).set("Authorization", auth);
        expect(res.status).toBe(202);
        expect((await WorkflowExecution.findById(orphan._id)).status).toBe("cancelled");
    });
});

describe("auth and ownership", () => {
    it("requires a token on every execution route", async () => {
        const id = new mongoose.Types.ObjectId();
        const routes = [
            request(app).post(`/api/workflows/${id}/execute`),
            request(app).get(`/api/workflows/${id}/executions`),
            request(app).get(`/api/executions/${id}`),
            request(app).post(`/api/executions/${id}/cancel`),
        ];
        for (const res of await Promise.all(routes)) expect(res.status).toBe(401);
    });

    it("returns 404 for another user's workflow or execution, and for malformed ids", async () => {
        const owner = await newUser();
        const intruder = await newUser();
        const workflowId = await createWorkflow(owner);
        const { executionId } = (await execute(owner, workflowId, {})).body.data;
        await waitFor(owner, executionId);

        const attempts = [
            execute(intruder, workflowId, {}),
            request(app).get(`/api/workflows/${workflowId}/executions`).set("Authorization", intruder),
            getExecution(intruder, executionId),
            request(app).post(`/api/executions/${executionId}/cancel`).set("Authorization", intruder),
            getExecution(owner, "not-an-id"),
            request(app).post("/api/executions/not-an-id/cancel").set("Authorization", owner),
        ];
        for (const res of await Promise.all(attempts)) {
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
        }
        // The intruder's attempt to run it created nothing.
        expect(await WorkflowExecution.countDocuments()).toBe(1);
    });
});

describe("markInterruptedExecutions (server boot)", () => {
    it("fails every execution left running, and its unfinished nodes", async () => {
        const ids = { workflow: new mongoose.Types.ObjectId(), owner: new mongoose.Types.ObjectId() };
        const stuck = await WorkflowExecution.create({
            ...ids,
            nodes: [
                { nodeId: "a", type: "manualTrigger", status: "success" },
                { nodeId: "b", type: "httpRequest", status: "running" },
                { nodeId: "c", type: "output", status: "idle" },
            ],
        });
        const finished = await WorkflowExecution.create({ ...ids, status: "completed" });

        expect(await markInterruptedExecutions()).toBe(1);

        const after = await WorkflowExecution.findById(stuck._id).lean();
        expect(after.status).toBe("failed");
        expect(after.error).toEqual({ nodeId: null, message: "server restarted" });
        expect(after.endedAt).toBeInstanceOf(Date);
        expect(after.nodes.map((r) => r.status)).toEqual(["success", "failed", "skipped"]);
        expect(after.nodes[2].skipReason).toBe("server restarted");
        expect((await WorkflowExecution.findById(finished._id)).status).toBe("completed");
    });
});
