import { describe, it, expect } from "vitest";
import { validateGraph } from "@/lib/graphValidation";
import { nextNodeId } from "@/lib/nodeTypes";

const node = (id, type, config = {}) => ({ id, type, data: { label: "", config } });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: null });

const trigger = node("trigger-1", "manualTrigger");
const output = node("output-1", "output", { message: "hi" });

describe("validateGraph", () => {
  it("accepts a complete trigger -> output graph", () => {
    expect(validateGraph([trigger, output], [edge("trigger-1", "output-1")])).toEqual([]);
  });

  it("requires a trigger", () => {
    const issues = validateGraph([output], []);
    expect(issues.map((i) => i.message)).toContain("Add a Manual Trigger to start the workflow");
  });

  it("rejects more than one trigger", () => {
    const issues = validateGraph([trigger, node("trigger-2", "manualTrigger")], []);
    expect(issues.some((i) => i.message.includes("only one Manual Trigger"))).toBe(true);
  });

  it("flags a node that is not connected to the trigger", () => {
    const issues = validateGraph([trigger, output], []);
    expect(issues).toEqual([expect.objectContaining({ nodeId: "output-1" })]);
  });

  it("flags every node in a cycle", () => {
    const a = node("a", "output", { message: "a" });
    const b = node("b", "output", { message: "b" });
    const issues = validateGraph([trigger, a, b], [edge("trigger-1", "a"), edge("a", "b"), edge("b", "a")]);
    const cyclic = issues.filter((i) => i.message.includes("cycle")).map((i) => i.nodeId);
    expect(cyclic.sort()).toEqual(["a", "b"]);
  });

  it("flags missing required config", () => {
    const http = node("http-1", "httpRequest", { method: "GET", url: "" });
    const issues = validateGraph([trigger, http], [edge("trigger-1", "http-1")]);
    expect(issues).toEqual([expect.objectContaining({ nodeId: "http-1", message: expect.stringContaining("URL") })]);
  });

  it("does not require a right value for isEmpty", () => {
    const cond = node("cond-1", "condition", { left: "{{nodes.trigger-1.output.x}}", operator: "isEmpty" });
    expect(validateGraph([trigger, cond], [edge("trigger-1", "cond-1")])).toEqual([]);
  });

  it("handles a diamond (converging branches) without false cycle reports", () => {
    const cond = node("cond-1", "condition", { left: "1", operator: "equals", right: "1" });
    const a = node("a", "output", { message: "a" });
    const b = node("b", "output", { message: "b" });
    const merge = node("merge", "output", { message: "m" });
    const edges = [edge("trigger-1", "cond-1"), edge("cond-1", "a"), edge("cond-1", "b"), edge("a", "merge"), edge("b", "merge")];
    expect(validateGraph([trigger, cond, a, b, merge], edges)).toEqual([]);
  });
});

describe("nextNodeId", () => {
  it("returns the first free readable id without dots", () => {
    expect(nextNodeId("httpRequest", [])).toBe("httpRequest-1");
    expect(nextNodeId("httpRequest", ["httpRequest-1", "httpRequest-2"])).toBe("httpRequest-3");
  });
});
