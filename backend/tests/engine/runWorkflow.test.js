import { describe, it, expect } from "vitest";
import { runWorkflow } from "../../src/engine/runWorkflow.js";
import { node, edge, workflow, trigger, output, condition, diamond } from "./fixtures.js";

const statuses = (result) => Object.fromEntries(result.nodes.map((r) => [r.nodeId, r.status]));
const record = (result, id) => result.nodes.find((r) => r.nodeId === id);

// Runs a workflow and also collects the events it emitted.
async function run(wf, input, options = {}) {
    const events = [];
    const result = await runWorkflow({ workflow: wf, input, emit: (e) => events.push(e), ...options });
    return { result, events };
}

describe("runWorkflow: linear", () => {
    it("passes outputs along and resolves expressions", async () => {
        const wf = workflow(
            [
                trigger(),
                node("shape", "transform", { operations: [{ type: "rename", params: { from: "n", to: "count" } }] }),
                output("out", "Hello {{input.name}}, count {{nodes.shape.output.count}}", [
                    { key: "count", value: "{{nodes.shape.output.count}}" },
                ]),
            ],
            [edge("trigger", "shape"), edge("shape", "out")]
        );
        const { result, events } = await run(wf, { name: "Ann", n: 7 });

        expect(result.status).toBe("completed");
        expect(record(result, "shape").input).toEqual({ name: "Ann", n: 7 });
        expect(record(result, "shape").output).toEqual({ name: "Ann", count: 7 });
        // The whole-string expression keeps the number type; the embedded one becomes text.
        expect(result.outputs.out).toEqual({ message: "Hello Ann, count 7", data: { count: 7 } });
        expect(result.logs.map((l) => l.message)).toEqual(["Hello Ann, count 7"]);
        expect(record(result, "out").attempts).toBe(1);
        expect(events.map((e) => e.type)).toEqual([
            "workflow.started",
            "node.started", "node.completed",
            "node.started", "node.completed",
            "node.started", "node.completed",
            "workflow.completed",
        ]);
    });
});

describe("runWorkflow: branching", () => {
    const branchy = () =>
        workflow(
            [trigger(), condition("check", "{{input.n}}", "greaterThan", "5"), output("yes", "big"), output("no", "small")],
            [edge("trigger", "check"), edge("check", "yes", "true"), edge("check", "no", "false")]
        );

    it("takes the true branch and skips the false one with a reason", async () => {
        const { result, events } = await run(branchy(), { n: 10 });
        expect(statuses(result)).toEqual({ trigger: "success", check: "success", yes: "success", no: "skipped" });
        expect(record(result, "check").branch).toBe("true");
        expect(record(result, "no").skipReason).toBe("Condition 'check' took the true branch");
        expect(events.find((e) => e.type === "node.skipped")).toMatchObject({ nodeId: "no" });
        expect(Object.keys(result.outputs)).toEqual(["yes"]);
    });

    it("takes the false branch", async () => {
        const { result } = await run(branchy(), { n: 1 });
        expect(statuses(result)).toMatchObject({ yes: "skipped", no: "success" });
        expect(record(result, "yes").skipReason).toBe("Condition 'check' took the false branch");
    });

    it("propagates a skip down a chain", async () => {
        const wf = branchy();
        wf.nodes.push(output("after-no", "x"));
        wf.edges.push(edge("no", "after-no"));
        const { result } = await run(wf, { n: 10 });
        expect(record(result, "after-no")).toMatchObject({ status: "skipped", skipReason: "Upstream node 'no' was skipped" });
    });
});

describe("runWorkflow: diamond (converging branches)", () => {
    const input = { items: [{ id: 1 }] };

    it("true: A runs, B is skipped, Merge still runs because A's edge is active", async () => {
        const { result } = await run(diamond(), { ...input, status: 200 });
        expect(result.nodes.map((r) => r.nodeId)).toEqual(["trigger", "check", "a", "b", "merge", "out"]);
        expect(statuses(result)).toEqual({
            trigger: "success", check: "success", a: "success", b: "skipped", merge: "success", out: "success",
        });
        expect(record(result, "merge").input.items[0].via).toBe("A");
        expect(result.outputs.out.message).toBe("Done: A");
    });

    it("false: B runs, A is skipped, Merge gets B's data", async () => {
        const { result } = await run(diamond(), { ...input, status: 500 });
        expect(statuses(result)).toMatchObject({ a: "skipped", b: "success", merge: "success" });
        expect(record(result, "a").skipReason).toBe("Condition 'check' took the false branch");
        expect(result.outputs.out.message).toBe("Done: B");
    });

    it("skips the merge node when all of its inputs are inactive", async () => {
        // Trigger -> Condition -(true)-> Merge ; Condition -(false)-> Other.
        // Merge's only input is the true branch: on false, it is skipped.
        const wf = workflow(
            [trigger(), condition("check", "{{input.ok}}", "equals", "true"), output("merge", "m"), output("other", "o")],
            [edge("trigger", "check"), edge("check", "merge", "true"), edge("check", "other", "false")]
        );
        const { result } = await run(wf, { ok: false });
        expect(statuses(result)).toMatchObject({ merge: "skipped", other: "success" });
    });
});

describe("runWorkflow: failure", () => {
    it("fails the node, skips the rest as 'upstream failed', keeps partial results", async () => {
        const wf = workflow(
            [
                trigger(),
                output("first", "ok"),
                node("bad", "transform", { operations: [{ type: "convert", params: { field: "age", to: "number" } }] }),
                output("last", "never"),
            ],
            [edge("trigger", "first"), edge("first", "bad"), edge("bad", "last")]
        );
        // "bad" receives first's output ({ message, data }), which has no numeric "age".
        const { result, events } = await run(wf, {});

        expect(result.status).toBe("failed");
        expect(statuses(result)).toEqual({ trigger: "success", first: "success", bad: "failed", last: "skipped" });
        expect(record(result, "bad").error).toMatch(/Operation 1 \(convert\): Cannot convert "age"/);
        expect(record(result, "last").skipReason).toBe("upstream failed");
        expect(result.error).toEqual({ nodeId: "bad", message: record(result, "bad").error });
        expect(result.outputs.first).toEqual({ message: "ok", data: {} }); // partial result kept
        expect(events.slice(-3).map((e) => e.type)).toEqual(["node.failed", "node.skipped", "workflow.failed"]);
    });

    it("fails a node whose expression points at a skipped ancestor", async () => {
        // check -(true)-> yes -> end, and check -(false)-> end. "yes" is an ancestor of "end",
        // so validation allows the reference, but on the false branch "yes" never runs.
        const wf = workflow(
            [
                trigger(),
                condition("check", "{{input.n}}", "equals", "1"),
                output("yes", "y"),
                output("end", "{{nodes.yes.output.message}}"),
            ],
            [edge("trigger", "check"), edge("check", "yes", "true"), edge("yes", "end"), edge("check", "end", "false")]
        );
        const { result } = await run(wf, { n: 1 });
        expect(result.outputs.end.message).toBe("y");

        const { result: other } = await run(wf, { n: 2 });
        expect(other.status).toBe("failed");
        expect(record(other, "end").error).toBe(
            'Expression "{{nodes.yes.output.message}}" refers to node "yes", which was skipped'
        );
    });

    it("runs nothing when validation fails", async () => {
        const events = [];
        await expect(
            runWorkflow({ workflow: workflow([output("o", "x")], []), emit: (e) => events.push(e) })
        ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_WORKFLOW" });
        expect(events).toEqual([]);
    });
});

describe("runWorkflow: cancellation", () => {
    it("stops before the next node and marks the execution cancelled", async () => {
        const controller = new AbortController();
        const wf = workflow(
            [trigger(), output("a", "a"), output("b", "b")],
            [edge("trigger", "a"), edge("a", "b")]
        );
        // Cancel as soon as "a" completes (what POST /cancel will do in Phase 5).
        const emit = (e) => e.type === "node.completed" && e.nodeId === "a" && controller.abort();
        const result = await runWorkflow({ workflow: wf, signal: controller.signal, emit });

        expect(result.status).toBe("cancelled");
        expect(statuses(result)).toEqual({ trigger: "success", a: "success", b: "skipped" });
        expect(record(result, "b").skipReason).toBe("execution cancelled");
    });
});
