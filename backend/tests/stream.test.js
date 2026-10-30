import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { nodeRegistry } from "../src/nodes/registry.js";
import * as hub from "../src/executions/executionHub.js";
import { WorkflowExecution } from "../src/models/WorkflowExecution.js";

// SSE needs a real server: supertest waits for the whole response, but here we must read the
// stream while it is still open (and release the slow node once the snapshot has arrived).
let server;
let baseUrl;
beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const realHttpExecute = nodeRegistry.httpRequest.execute;
afterEach(() => {
    nodeRegistry.httpRequest.execute = realHttpExecute;
});

let counter = 0;
async function newUser() {
    counter += 1;
    const res = await request(app).post("/api/auth/register").send({ email: `stream${counter}@test.com`, password: "password123" });
    return `Bearer ${res.body.data.token}`;
}

const n = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, config } });
const e = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: null });
const withHttp = {
    name: "Stream test",
    nodes: [
        n("trigger-1", "manualTrigger", {}),
        n("http", "httpRequest", { method: "GET", url: "https://example.com", retry: { maxAttempts: 1, backoffMs: 0 } }),
        n("out", "output", { message: "done" }),
    ],
    edges: [e("trigger-1", "http"), e("http", "out")],
};

async function startRun(auth) {
    const created = await request(app).post("/api/workflows").set("Authorization", auth).send(withHttp);
    const res = await request(app).post(`/api/workflows/${created.body.data.workflow._id}/execute`).set("Authorization", auth).send({});
    return res.body.data.executionId;
}

// A minimal SSE reader for the tests: "event: x\ndata: {...}\n\n" blocks; ":" lines are comments.
// Calls onEvent for each event and resolves with all of them when the server closes the stream.
async function readStream(response, onEvent = () => {}) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const events = [];
    let text = "";
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return events;
        text += value;
        let end;
        while ((end = text.indexOf("\n\n")) !== -1) {
            const block = text.slice(0, end);
            text = text.slice(end + 2);
            const type = block.match(/^event: (.*)$/m)?.[1];
            const data = block.match(/^data: (.*)$/m)?.[1];
            if (!type) continue; // heartbeat comment
            const event = { type, data: JSON.parse(data) };
            events.push(event);
            onEvent(event);
        }
    }
}

const open = (id, auth, signal) => fetch(`${baseUrl}/executions/${id}/stream`, { headers: auth ? { Authorization: auth } : {}, signal });

describe("GET /api/executions/:id/stream", () => {
    it("sends the snapshot, then live events in order, then closes after the final event", async () => {
        // The http node waits until the test lets it finish, so the stream connects mid-run.
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        nodeRegistry.httpRequest.execute = async () => {
            await gate;
            return { output: { ok: true } };
        };
        const auth = await newUser();
        const id = await startRun(auth);

        const response = await open(id, auth);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);

        const events = await readStream(response, (event) => event.type === "snapshot" && release());

        expect(events[0].type).toBe("snapshot");
        expect(events[0].data).toMatchObject({ _id: id, status: "running" });
        // Events published before the snapshot was read can arrive again after it (at-least-once).
        // What matters: nothing is missing and the order after the snapshot is the engine's order.
        const live = events.slice(1).map((x) => `${x.type}:${x.data.nodeId ?? ""}`);
        expect(live.slice(-4)).toEqual(["node.completed:http", "node.started:out", "node.completed:out", "workflow.completed:"]);
        expect(events.at(-1).data).toMatchObject({ executionId: id, status: "completed" });
        // Node events carry the stored record, so the client can render input/output live.
        expect(events.find((x) => x.type === "node.completed" && x.data.nodeId === "http").data.record).toMatchObject({
            status: "success",
            output: { ok: true },
        });
        expect(hub.listenerCount(id)).toBe(0);
    });

    it("does not lose an event published while the snapshot is being read", async () => {
        nodeRegistry.httpRequest.execute = ({ signal }) =>
            new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        const auth = await newUser();
        const id = await startRun(auth);

        // Publish an event in the middle of the stream's database read, i.e. after the snapshot
        // was taken but before it was sent. Subscribing first is what makes this arrive.
        const realFindOne = WorkflowExecution.findOne.bind(WorkflowExecution);
        const spy = vi.spyOn(WorkflowExecution, "findOne").mockImplementationOnce((...args) => {
            const query = realFindOne(...args);
            hub.publish(id, { type: "node.started", executionId: id, nodeId: "during-read" });
            return query;
        });
        const controller = new AbortController();
        const events = [];
        const reading = readStream(await open(id, auth, controller.signal), (event) => {
            events.push(event);
            if (event.data.nodeId === "during-read") controller.abort();
        }).catch(() => {});
        await reading;
        spy.mockRestore();

        // Real engine events may be buffered too; the point is that the injected one is delivered.
        expect(events[0].type).toBe("snapshot");
        expect(events.some((x) => x.type === "node.started" && x.data.nodeId === "during-read")).toBe(true);
        await request(app).post(`/api/executions/${id}/cancel`).set("Authorization", auth);
    });

    it("sends only the snapshot for a finished execution", async () => {
        nodeRegistry.httpRequest.execute = async () => ({ output: {} });
        const auth = await newUser();
        const id = await startRun(auth);
        // Wait for the run to end.
        for (let i = 0; i < 200; i++) {
            const res = await request(app).get(`/api/executions/${id}`).set("Authorization", auth);
            if (res.body.data.execution.status !== "running") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        const events = await readStream(await open(id, auth));
        expect(events.map((x) => x.type)).toEqual(["snapshot"]);
        expect(events[0].data.status).toBe("completed");
        expect(events[0].data.nodes.map((r) => r.status)).toEqual(["success", "success", "success"]);
    });

    it("stops listening when the client disconnects", async () => {
        nodeRegistry.httpRequest.execute = ({ signal }) =>
            new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        const auth = await newUser();
        const id = await startRun(auth);

        const controller = new AbortController();
        const response = await open(id, auth, controller.signal);
        const reader = response.body.getReader();
        await reader.read(); // the snapshot
        expect(hub.listenerCount(id)).toBe(1);

        controller.abort();
        for (let i = 0; i < 100 && hub.listenerCount(id) > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hub.listenerCount(id)).toBe(0);

        // Clean up the still-running execution.
        await request(app).post(`/api/executions/${id}/cancel`).set("Authorization", auth);
    });

    it("needs a token, and answers 404 (as JSON, not a stream) for someone else's execution", async () => {
        nodeRegistry.httpRequest.execute = async () => ({ output: {} });
        const owner = await newUser();
        const intruder = await newUser();
        const id = await startRun(owner);

        expect((await open(id)).status).toBe(401);

        const res = await open(id, intruder);
        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toMatch(/json/);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
        expect((await open("not-an-id", owner)).status).toBe(404);
        // The rejected requests left no listener behind.
        expect(hub.listenerCount(id)).toBe(0);
    });
});
