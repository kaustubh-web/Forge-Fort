import { describe, it, expect } from "vitest";
import { demoStateAt, DEMO_EDGES, DEMO_LENGTH_MS } from "@/lib/demoRun";
import { nodeStatuses, executedEdgeIds } from "@/lib/executionState";

describe("demoStateAt", () => {
  it("starts with every node idle and an empty log", () => {
    const state = demoStateAt(0);
    expect(Object.values(nodeStatuses(state)).every((s) => s === "idle")).toBe(true);
    expect(state.log).toEqual([]);
    expect(state.status).toBe("running");
  });

  it("mid-run: earlier nodes succeeded, the condition is running, nothing after it started", () => {
    const state = demoStateAt(2300);
    expect(nodeStatuses(state)).toMatchObject({
      "trigger-1": "success",
      "geo-1": "success",
      "found-1": "running",
      "ai-1": "idle",
      "notfound-1": "idle",
    });
    expect(state.log.map((line) => line.nodeId)).toEqual(["trigger-1", "geo-1"]);
  });

  it("finished: the true branch ran, the false branch was skipped with a reason", () => {
    const state = demoStateAt(DEMO_LENGTH_MS - 1);
    expect(state.status).toBe("completed");
    expect(nodeStatuses(state)).toEqual({
      "trigger-1": "success",
      "geo-1": "success",
      "found-1": "success",
      "ai-1": "success",
      "notfound-1": "skipped",
    });
    expect(state.log.find((line) => line.nodeId === "notfound-1").text).toBe(
      "Skipped: Condition 'found-1' took the true branch"
    );
  });

  it("works with the editor's executed-path helper: only the taken branch lights up", () => {
    expect([...executedEdgeIds(demoStateAt(DEMO_LENGTH_MS - 1), DEMO_EDGES)]).toEqual(["e1", "e2", "e3"]);
  });
});
