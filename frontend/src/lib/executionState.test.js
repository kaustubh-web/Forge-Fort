import { describe, it, expect } from "vitest";
import { fromSnapshot, applyEvent, nodeStatuses, executedEdgeIds, isFinished } from "@/lib/executionState";

const record = (nodeId, status, extra = {}) => ({ nodeId, type: "output", status, attempts: 0, ...extra });

const snapshot = (status = "running", nodes = [record("trigger", "success"), record("check", "running"), record("yes", "idle"), record("no", "idle")]) => ({
  _id: "exec-1",
  status,
  error: null,
  input: { n: 7 },
  nodes,
  outputs: {},
  logs: [],
  startedAt: "2026-10-30T10:00:00.000Z",
  endedAt: null,
  durationMs: null,
});

const nodeEvent = (type, rec) => ({ type, data: { executionId: "exec-1", nodeId: rec.nodeId, record: rec } });

describe("fromSnapshot", () => {
  it("keeps the run order and indexes records by node id", () => {
    const state = fromSnapshot(snapshot());
    expect(state.executionId).toBe("exec-1");
    expect(state.order).toEqual(["trigger", "check", "yes", "no"]);
    expect(state.nodes.check.status).toBe("running");
    expect(state.input).toEqual({ n: 7 });
  });
});

describe("applyEvent", () => {
  it("a snapshot event replaces the whole state", () => {
    const state = applyEvent(null, { type: "snapshot", data: snapshot() });
    expect(state.status).toBe("running");
  });

  it("node events store the record they carry", () => {
    let state = fromSnapshot(snapshot());
    state = applyEvent(state, nodeEvent("node.completed", record("check", "success", { branch: "true", attempts: 1 })));
    state = applyEvent(state, nodeEvent("node.skipped", record("no", "skipped", { skipReason: "Condition 'check' took the true branch" })));
    expect(state.nodes.check).toMatchObject({ status: "success", branch: "true" });
    expect(state.nodes.no.skipReason).toMatch(/true branch/);
  });

  it("an old repeated event never moves a node backwards", () => {
    // The snapshot already has check=success; the buffered node.started arrives after it.
    let state = fromSnapshot(snapshot("running", [record("check", "success", { attempts: 1 })]));
    const before = state;
    state = applyEvent(state, nodeEvent("node.started", record("check", "running", { attempts: 1 })));
    expect(state).toBe(before); // unchanged, same object
    expect(state.nodes.check.status).toBe("success");
  });

  it("a retry (running again with more attempts) does update the node", () => {
    let state = fromSnapshot(snapshot("running", [record("http", "running", { attempts: 1 })]));
    state = applyEvent(state, nodeEvent("node.started", record("http", "running", { attempts: 2, attemptLog: [{ attempt: 1 }] })));
    expect(state.nodes.http.attempts).toBe(2);
  });

  it("final workflow events set the status and error", () => {
    let state = fromSnapshot(snapshot());
    state = applyEvent(state, {
      type: "workflow.failed",
      data: { executionId: "exec-1", status: "failed", error: { nodeId: "check", message: "boom" } },
    });
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ nodeId: "check", message: "boom" });
    // A repeated workflow.started cannot revive a finished run.
    expect(applyEvent(state, { type: "workflow.started", data: { executionId: "exec-1" } }).status).toBe("failed");
  });

  it("ignores events before a snapshot or from another execution", () => {
    const event = nodeEvent("node.completed", record("check", "success"));
    expect(applyEvent(null, event)).toBeNull();
    const state = fromSnapshot(snapshot());
    expect(applyEvent(state, { ...event, data: { ...event.data, executionId: "exec-2" } })).toBe(state);
  });
});

describe("helpers", () => {
  it("isFinished", () => {
    expect(["completed", "failed", "cancelled"].every(isFinished)).toBe(true);
    expect(isFinished("running")).toBe(false);
  });

  it("nodeStatuses maps node id to status", () => {
    expect(nodeStatuses(fromSnapshot(snapshot()))).toEqual({ trigger: "success", check: "running", yes: "idle", no: "idle" });
    expect(nodeStatuses(null)).toEqual({});
  });

  it("executedEdgeIds follows only the branch that was taken", () => {
    const state = fromSnapshot(
      snapshot("completed", [
        record("trigger", "success"),
        record("check", "success", { branch: "true" }),
        record("yes", "success"),
        record("no", "skipped"),
        record("merge", "success"),
      ])
    );
    const edges = [
      { id: "e1", source: "trigger", target: "check", sourceHandle: null },
      { id: "e2", source: "check", target: "yes", sourceHandle: "true" },
      { id: "e3", source: "check", target: "no", sourceHandle: "false" },
      { id: "e4", source: "yes", target: "merge", sourceHandle: null },
      { id: "e5", source: "no", target: "merge", sourceHandle: null },
    ];
    expect([...executedEdgeIds(state, edges)].sort()).toEqual(["e1", "e2", "e4"]);
    expect(executedEdgeIds(null, edges).size).toBe(0);
  });
});
