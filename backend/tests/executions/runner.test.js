import { describe, it, expect, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { WorkflowExecution } from "../../src/models/WorkflowExecution.js";
import { startExecution } from "../../src/executions/executionRunner.js";
import * as runningExecutions from "../../src/executions/runningExecutions.js";
import * as hub from "../../src/executions/executionHub.js";
import { validateForRun } from "../../src/engine/validateForRun.js";
import { nodeRegistry } from "../../src/nodes/registry.js";
import { NodeError } from "../../src/engine/errors.js";
import { REDACTED, redactDeep } from "../../src/utils/redact.js";
import { node, edge, workflow, trigger, output, condition } from "../engine/fixtures.js";

// The HTTP node's real handler is swapped for a fake in each test, so nothing touches the network.
const realHttpExecute = nodeRegistry.httpRequest.execute;
afterEach(() => {
    nodeRegistry.httpRequest.execute = realHttpExecute;
});

const http = (id) => node(id, "httpRequest", { method: "GET", url: "https://example.com", retry: { maxAttempts: 1, backoffMs: 0 } });

// trigger -> http -> output
const linear = () =>
    workflow(
        [trigger(), http("http"), output("out", "Got {{nodes.http.output.value}}")],
        [edge("trigger", "http"), edge("http", "out")]
    );

// Creates the execution record the way the service does: one idle record per node, in run order,
// and the run input stored redacted.
async function createExecution(wf, input = {}) {
    const { order, graph } = validateForRun(wf);
    return WorkflowExecution.create({
        workflow: new mongoose.Types.ObjectId(),
        owner: new mongoose.Types.ObjectId(),
        input: redactDeep(input),
        nodes: order.map((id) => ({ nodeId: id, type: graph.nodeById.get(id).type, label: graph.nodeById.get(id).data.label })),
        metadata: { workflowName: wf.name },
    });
}

// Runs to the end and collects every event published to the hub.
async function runAndCollect(wf, input, options = {}) {
    const execution = await createExecution(wf, input);
    const events = [];
    const unsubscribe = hub.subscribe(execution._id, (e) => events.push(e));
    const done = startExecution({ execution, workflow: wf, input, ...options });
    options.whileRunning?.(execution);
    await done;
    unsubscribe();
    const stored = await WorkflowExecution.findById(execution._id).lean();
    return { execution, events, stored };
}

const byId = (stored, id) => stored.nodes.find((n) => n.nodeId === id);

describe("executionRunner", () => {
    it("persists every node and the final result, and publishes events in order", async () => {
        nodeRegistry.httpRequest.execute = async () => ({ output: { value: 42 } });
        const { events, stored } = await runAndCollect(linear());

        expect(stored.status).toBe("completed");
        expect(stored.nodes.map((n) => [n.nodeId, n.status])).toEqual([
            ["trigger", "success"],
            ["http", "success"],
            ["out", "success"],
        ]);
        expect(byId(stored, "http")).toMatchObject({ output: { value: 42 }, attempts: 1 });
        expect(byId(stored, "http").durationMs).toBeTypeOf("number");
        expect(stored.outputs.out).toEqual({ message: "Got 42", data: {} });
        expect(stored.logs.map((l) => l.message)).toEqual(["Got 42"]);
        expect(stored.endedAt).toBeInstanceOf(Date);

        expect(events.map((e) => e.type)).toEqual([
            "workflow.started",
            "node.started", "node.completed",
            "node.started", "node.completed",
            "node.started", "node.completed",
            "workflow.completed",
        ]);
        expect(runningExecutions.isRunning(stored._id)).toBe(false);
        expect(hub.listenerCount(stored._id)).toBe(0);
    });

    it("has already saved a node when its event is published (persist, then publish)", async () => {
        nodeRegistry.httpRequest.execute = async () => ({ output: { value: 1 } });
        const execution = await createExecution(linear());
        const seen = [];
        hub.subscribe(execution._id, (e) => {
            if (e.type === "node.completed" && e.nodeId === "http") {
                seen.push(WorkflowExecution.findById(execution._id).lean());
            }
            if (e.type === "workflow.completed") seen.push(WorkflowExecution.findById(execution._id).lean());
        });
        await startExecution({ execution, workflow: linear() });

        const [atNode, atEnd] = await Promise.all(seen);
        expect(byId(atNode, "http").status).toBe("success");
        // The final event is only sent once outputs and logs are stored.
        expect(atEnd.status).toBe("completed");
        expect(atEnd.outputs.out).toBeDefined();
    });

    it("keeps partial results when a node fails", async () => {
        nodeRegistry.httpRequest.execute = async () => {
            throw new NodeError("HTTP 404 Not Found");
        };
        const { events, stored } = await runAndCollect(linear());

        expect(stored.status).toBe("failed");
        expect(stored.error).toEqual({ nodeId: "http", message: "HTTP 404 Not Found" });
        expect(byId(stored, "trigger").status).toBe("success");
        expect(byId(stored, "http")).toMatchObject({ status: "failed", error: "HTTP 404 Not Found", attempts: 1 });
        expect(byId(stored, "out")).toMatchObject({ status: "skipped", skipReason: "upstream failed" });
        expect(events.at(-1).type).toBe("workflow.failed");
    });

    it("stores the skip reason of an untaken branch", async () => {
        const wf = workflow(
            [trigger(), condition("check", "{{input.n}}", "greaterThan", "5"), output("yes", "big"), output("no", "small")],
            [edge("trigger", "check"), edge("check", "yes", "true"), edge("check", "no", "false")]
        );
        const { stored } = await runAndCollect(wf, { n: 1 });
        expect(byId(stored, "check").branch).toBe("false");
        expect(byId(stored, "yes")).toMatchObject({ status: "skipped", skipReason: "Condition 'check' took the false branch" });
        expect(Object.keys(stored.outputs)).toEqual(["no"]);
    });

    it("cancels a running node through the registered controller", async () => {
        // A slow handler that only ends when its signal aborts, like a real fetch would.
        nodeRegistry.httpRequest.execute = ({ signal }) =>
            new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

        const { events, stored } = await runAndCollect(linear(), {}, {
            whileRunning: (execution) => {
                hub.subscribe(execution._id, (e) => {
                    if (e.type === "node.started" && e.nodeId === "http") {
                        expect(runningExecutions.cancel(execution._id)).toBe(true);
                    }
                });
            },
        });

        expect(stored.status).toBe("cancelled");
        expect(stored.error).toBeNull();
        expect(byId(stored, "http")).toMatchObject({ status: "failed", error: "Cancelled" });
        expect(byId(stored, "out")).toMatchObject({ status: "skipped", skipReason: "execution cancelled" });
        expect(events.at(-1).type).toBe("workflow.cancelled");
        expect(runningExecutions.cancel(stored._id)).toBe(false); // already unregistered
    });

    it("redacts secrets in stored and streamed data, but the engine still gets the real value", async () => {
        let headerSeen;
        nodeRegistry.httpRequest.execute = async ({ config }) => {
            headerSeen = config.headers?.[0]?.value;
            return { output: { value: 1, auth: { apiKey: "sk-live-123", user: "ann" } } };
        };
        const wf = linear();
        wf.nodes[1].data.config.headers = [{ key: "Authorization", value: "Bearer {{input.password}}" }];

        const { events, stored } = await runAndCollect(wf, { password: "hunter2", name: "Ann" });

        expect(headerSeen).toBe("Bearer hunter2");
        expect(byId(stored, "trigger").output).toEqual({ password: REDACTED, name: "Ann" });
        expect(byId(stored, "http").input).toEqual({ password: REDACTED, name: "Ann" });
        expect(byId(stored, "http").output.auth).toEqual({ apiKey: REDACTED, user: "ann" });
        expect(JSON.stringify(events)).not.toMatch(/hunter2|sk-live-123/);
        expect(JSON.stringify(stored)).not.toMatch(/hunter2|sk-live-123/);
    });

    it("stores API responses whose keys contain dots or start with $", async () => {
        nodeRegistry.httpRequest.execute = async () => ({ output: { value: 1, body: { $ref: "#/a", "a.b": 2 } } });
        const { stored } = await runAndCollect(linear());
        expect(stored.status).toBe("completed");
        expect(byId(stored, "http").output.body).toEqual({ $ref: "#/a", "a.b": 2 });
    });

    it("records a crash as a failed execution instead of swallowing it", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        nodeRegistry.httpRequest.execute = async () => ({ output: { value: 1 } });
        const execution = await createExecution(linear());
        // The stored records no longer match the graph: the runner cannot place "out".
        await WorkflowExecution.updateOne({ _id: execution._id }, { $pop: { nodes: 1 } });
        const broken = await WorkflowExecution.findById(execution._id);

        const events = [];
        hub.subscribe(broken._id, (e) => events.push(e));
        await expect(startExecution({ execution: broken, workflow: linear() })).resolves.toBeUndefined();

        const stored = await WorkflowExecution.findById(execution._id).lean();
        expect(stored.status).toBe("failed");
        expect(stored.error.message).toMatch(/Execution error: Runner bug/);
        expect(byId(stored, "http").status).toBe("success");
        expect(events.at(-1)).toMatchObject({ type: "workflow.failed", status: "failed" });
        expect(errorLog).toHaveBeenCalled();
        errorLog.mockRestore();
    });

    it("marks interrupted nodes when it crashes mid-run", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        const execution = await createExecution(linear());
        // Make the database write for the http node's completion fail.
        nodeRegistry.httpRequest.execute = async () => {
            vi.spyOn(WorkflowExecution, "updateOne").mockRejectedValueOnce(new Error("connection lost"));
            return { output: { value: 1 } };
        };
        await startExecution({ execution, workflow: linear() });
        vi.restoreAllMocks();

        const stored = await WorkflowExecution.findById(execution._id).lean();
        expect(stored.status).toBe("failed");
        expect(stored.error.message).toBe("Execution error: connection lost");
        expect(byId(stored, "http")).toMatchObject({ status: "failed", error: "Execution error: connection lost" });
        expect(byId(stored, "out")).toMatchObject({ status: "skipped", skipReason: "execution error" });
        errorLog.mockRestore();
    });
});
