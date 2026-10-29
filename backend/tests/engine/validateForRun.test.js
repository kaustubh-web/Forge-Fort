import { describe, it, expect } from "vitest";
import { validateForRun } from "../../src/engine/validateForRun.js";
import { nodeRegistry } from "../../src/nodes/registry.js";
import { node, edge, workflow, trigger, output, condition, diamond } from "./fixtures.js";

// Returns the issue messages, or [] when the workflow is runnable.
function issues(wf) {
    try {
        validateForRun(wf);
        return [];
    } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("INVALID_WORKFLOW");
        return error.details.map((d) => d.message);
    }
}

describe("validateForRun", () => {
    it("accepts a valid diamond and returns the run order", () => {
        const { order } = validateForRun(diamond());
        expect(order).toEqual(["trigger", "check", "a", "b", "merge", "out"]);
    });

    it("rejects malformed JSON and unknown node types", () => {
        expect(issues({ name: "x", nodes: "nope", edges: [] }).length).toBeGreaterThan(0);
        expect(issues(workflow([trigger(), node("x", "shellCommand")], [])).length).toBeGreaterThan(0);
    });

    it("needs exactly one trigger", () => {
        expect(issues(workflow([output("o", "hi")], []))).toContain("The workflow needs a Manual Trigger");
        const two = workflow([trigger("t1"), trigger("t2")], []);
        expect(issues(two)[0]).toMatch(/2 triggers/);
    });

    it("rejects cycles", () => {
        const wf = workflow(
            [trigger(), output("a", "a"), output("b", "b")],
            [edge("trigger", "a"), edge("a", "b"), edge("b", "a")]
        );
        expect(issues(wf)).toEqual(expect.arrayContaining([expect.stringMatching(/"a" is part of/), expect.stringMatching(/"b" is part of/)]));
    });

    it("rejects nodes the trigger cannot reach", () => {
        const wf = workflow([trigger(), output("lonely", "hi")], []);
        expect(issues(wf)).toContain('Node "lonely" is not connected to the trigger');
    });

    it("rejects missing required config", () => {
        const wf = workflow([trigger(), condition("c", "", "equals", "")], [edge("trigger", "c")]);
        expect(issues(wf)).toContain('Node "c" is missing: Left value, Right value');
    });

    it("rejects node types without a handler yet", () => {
        // Every v1 type has a handler now, so take one away to check the guard for future types.
        const { execute } = nodeRegistry.httpRequest;
        delete nodeRegistry.httpRequest.execute;
        try {
            const wf = workflow([trigger(), node("h", "httpRequest", { url: "https://example.com" })], [edge("trigger", "h")]);
            expect(issues(wf)).toContain('Node "h" (httpRequest) cannot run yet: no handler');
        } finally {
            nodeRegistry.httpRequest.execute = execute;
        }
    });

    it("rejects expressions to unknown, later or unrelated nodes", () => {
        const wf = workflow(
            [
                trigger(),
                output("first", "{{nodes.second.output.message}}"),
                output("second", "{{nodes.ghost.output.x}}"),
                output("bad", "{{secrets.key}}"),
            ],
            [edge("trigger", "first"), edge("first", "second"), edge("trigger", "bad")]
        );
        expect(issues(wf)).toEqual([
            'Node "first" refers to "second", which does not run before it',
            'Node "second" refers to unknown node "ghost"',
            'Node "bad": Expression "{{secrets.key}}" must start with nodes, input or item',
        ]);
    });
});
