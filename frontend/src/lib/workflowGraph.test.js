import { describe, it, expect } from "vitest";
import { toFlowNodes, toFlowEdges, toWorkflowJson } from "@/lib/workflowGraph";

const saved = {
  name: "Demo",
  description: "d",
  nodes: [
    { id: "trigger-1", type: "manualTrigger", position: { x: 10, y: 20 }, data: { label: "Start", config: {} } },
    { id: "cond-1", type: "condition", position: { x: 200, y: 20 }, data: { label: "Check", config: { left: "1" } } },
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "cond-1", sourceHandle: null }],
};

describe("workflowGraph", () => {
  it("round-trips a saved workflow unchanged", () => {
    const back = toWorkflowJson({
      name: saved.name,
      description: saved.description,
      nodes: toFlowNodes(saved.nodes),
      edges: toFlowEdges(saved.edges),
    });
    expect(back).toEqual(saved);
  });

  it("drops React Flow UI-only fields before saving", () => {
    const uiNode = {
      ...toFlowNodes(saved.nodes)[0],
      selected: true,
      dragging: true,
      measured: { width: 200, height: 50 },
      data: { label: "Start", config: {}, status: "running" },
    };
    const json = toWorkflowJson({ name: "x", nodes: [uiNode], edges: [] });
    expect(Object.keys(json.nodes[0]).sort()).toEqual(["data", "id", "position", "type"]);
    expect(json.nodes[0].data).toEqual({ label: "Start", config: {} });
  });

  it("rounds positions and defaults missing handles to null", () => {
    const json = toWorkflowJson({
      name: "x",
      nodes: [{ id: "a", type: "output", position: { x: 10.7, y: -3.2 }, data: { label: "", config: {} } }],
      edges: [{ id: "e", source: "a", target: "b" }],
    });
    expect(json.nodes[0].position).toEqual({ x: 11, y: -3 });
    expect(json.edges[0].sourceHandle).toBeNull();
  });
});
