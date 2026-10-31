import { describe, it, expect } from "vitest";
import { resolveTemplate, resolveConfig, findExpressions, parsePath, findEmptyExpressions } from "../../src/engine/expressions.js";

const scope = {
    input: { email: "a@b.com", count: 3 },
    nodes: {
        "http-1": {
            status: "success",
            output: { status: 200, body: { title: "Hello", tags: ["x", "y"], items: [{ name: "first" }] } },
        },
        "skipped-1": { status: "skipped", output: null },
    },
};

describe("resolveTemplate", () => {
    it("keeps the type when the whole string is one expression", () => {
        expect(resolveTemplate("{{nodes.http-1.output.status}}", scope)).toBe(200);
        expect(resolveTemplate("{{ nodes.http-1.output.body.tags }}", scope)).toEqual(["x", "y"]);
        expect(resolveTemplate("{{input.count}}", scope)).toBe(3);
    });

    it("turns embedded expressions into text", () => {
        expect(resolveTemplate("Status {{nodes.http-1.output.status}}!", scope)).toBe("Status 200!");
        expect(resolveTemplate("Tags: {{nodes.http-1.output.body.tags}}", scope)).toBe('Tags: ["x","y"]');
        expect(resolveTemplate("{{input.email}} / {{input.count}}", scope)).toBe("a@b.com / 3");
    });

    it("walks array indexes", () => {
        expect(resolveTemplate("{{nodes.http-1.output.body.items.0.name}}", scope)).toBe("first");
    });

    it("gives undefined (or empty text) for a missing field in a real output", () => {
        expect(resolveTemplate("{{nodes.http-1.output.body.nope.deeper}}", scope)).toBeUndefined();
        expect(resolveTemplate("x{{input.missing}}y", scope)).toBe("xy");
    });

    it("fails loudly for a node that has not run or did not succeed", () => {
        expect(() => resolveTemplate("{{nodes.ghost.output.x}}", scope)).toThrow(/has not run/);
        expect(() => resolveTemplate("{{nodes.skipped-1.output.x}}", scope)).toThrow(/was skipped/);
    });

    it("never reads inherited or prototype properties", () => {
        expect(() => resolveTemplate("{{input.__proto__}}", scope)).toThrow(/forbidden/);
        expect(() => resolveTemplate("{{input.constructor.name}}", scope)).toThrow(/forbidden/);
        expect(resolveTemplate("{{input.toString}}", scope)).toBeUndefined();
        expect(resolveTemplate("{{input.hasOwnProperty}}", scope)).toBeUndefined();
    });

    it("treats code as a plain (invalid) path, never runs it", () => {
        expect(() => resolveTemplate("{{process.exit()}}", scope)).toThrow(/must start with/);
        expect(() => resolveTemplate("{{ 1 + 1 }}", scope)).toThrow(/must start with/);
    });

    it("leaves {{item...}} alone unless an item is in scope", () => {
        expect(resolveTemplate("{{item.name}}", scope)).toBe("{{item.name}}");
        expect(resolveTemplate("Hi {{item.name}}", { ...scope, item: { name: "Ann" } })).toBe("Hi Ann");
    });

    it("leaves text without expressions unchanged", () => {
        expect(resolveTemplate("plain {text}", scope)).toBe("plain {text}");
    });
});

describe("resolveConfig", () => {
    it("resolves strings at any depth without changing the original", () => {
        const config = { a: "{{input.count}}", list: [{ value: "{{input.email}}" }], n: 5 };
        expect(resolveConfig(config, scope)).toEqual({ a: 3, list: [{ value: "a@b.com" }], n: 5 });
        expect(config.a).toBe("{{input.count}}");
    });
});

describe("findExpressions / parsePath", () => {
    it("finds every expression with its node id", () => {
        const found = findExpressions({ left: "{{nodes.a.output.x}}", data: [{ value: "{{input.y}} {{nodes.b.output}}" }] });
        expect(found.map((f) => f.nodeId ?? f.root)).toEqual(["a", "input", "b"]);
    });

    it("rejects malformed paths", () => {
        expect(parsePath("nodes.a.status").error).toMatch(/nodes.<id>.output/);
        expect(parsePath("nodes..output").error).toMatch(/Invalid/);
        expect(parsePath("nodes.a.output.prototype").error).toMatch(/forbidden/);
    });
});

describe("findEmptyExpressions", () => {
    it("lists expressions whose value is missing, null or an empty string", () => {
        const s = { input: { a: 1, blank: "", nothing: null }, nodes: {} };
        expect(findEmptyExpressions("/x/{{input.a}}/{{input.b}}?q={{ input.blank }}&n={{input.nothing}}", s)).toEqual([
            "{{input.b}}",
            "{{ input.blank }}",
            "{{input.nothing}}",
        ]);
        expect(findEmptyExpressions("/x/{{input.a}}", s)).toEqual([]);
        expect(findEmptyExpressions(undefined, s)).toEqual([]);
    });
});
