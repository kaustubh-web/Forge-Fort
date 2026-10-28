import { describe, it, expect, vi } from "vitest";
import { nodeRegistry } from "../../src/nodes/registry.js";

const { manualTrigger, condition, transform, output } = nodeRegistry;
const runTransform = (input, operations) => transform.execute({ config: { operations }, input }).output;

describe("manualTrigger", () => {
    it("outputs the run input (or an empty object)", () => {
        expect(manualTrigger.execute({ input: { a: 1 } })).toEqual({ output: { a: 1 } });
        expect(manualTrigger.execute({ input: undefined })).toEqual({ output: {} });
    });
});

describe("condition", () => {
    it("returns the branch and passes its input through", () => {
        const input = { status: 200 };
        const result = condition.execute({ config: { left: 200, operator: "equals", right: "200" }, input });
        expect(result).toEqual({ output: input, branch: "true" });
        expect(condition.execute({ config: { left: 1, operator: "greaterThan", right: "5" }, input }).branch).toBe("false");
    });

    it("lists missing fields, but not Right for isEmpty", () => {
        expect(condition.requiredFields({})).toEqual(["Left value", "Operator", "Right value"]);
        expect(condition.requiredFields({ left: "x", operator: "isEmpty" })).toEqual([]);
    });
});

describe("output", () => {
    it("builds message + data and writes the message to the log", () => {
        const log = vi.fn();
        const result = output.execute({
            config: { message: "Got 3", data: [{ key: "count", value: 3 }] },
            log,
        });
        expect(result.output).toEqual({ message: "Got 3", data: { count: 3 } });
        expect(log).toHaveBeenCalledWith("Got 3");
    });
});

describe("transform", () => {
    const users = [
        { name: "Ann", age: "31", active: "true", city: "Pune" },
        { name: "Bob", age: "17", active: "false", city: "Delhi" },
    ];

    it("select keeps listed fields (per item on a list)", () => {
        expect(runTransform(users, [{ type: "select", params: { fields: ["name", "missing"] } }])).toEqual([
            { name: "Ann" },
            { name: "Bob" },
        ]);
    });

    it("rename renames a field and ignores a missing one", () => {
        expect(runTransform({ a: 1, b: 2 }, [{ type: "rename", params: { from: "a", to: "x" } }])).toEqual({ x: 1, b: 2 });
        expect(runTransform({ b: 2 }, [{ type: "rename", params: { from: "a", to: "x" } }])).toEqual({ b: 2 });
    });

    it("filter keeps matching items at a path", () => {
        const result = runTransform({ users }, [
            { type: "filter", params: { path: "users", field: "age", operator: "greaterThan", value: "18" } },
        ]);
        expect(result.users.map((u) => u.name)).toEqual(["Ann"]);
    });

    it("map sets a field per item, with {{item.x}}", () => {
        const result = runTransform(users, [{ type: "map", params: { field: "label", value: "{{item.name}} from {{item.city}}" } }]);
        expect(result.map((u) => u.label)).toEqual(["Ann from Pune", "Bob from Delhi"]);
    });

    it("merge adds fields from another object", () => {
        expect(runTransform({ a: 1 }, [{ type: "merge", params: { source: { b: 2 } } }])).toEqual({ a: 1, b: 2 });
    });

    it("convert changes types and fails clearly on bad data", () => {
        const result = runTransform(users, [
            { type: "convert", params: { field: "age", to: "number" } },
            { type: "convert", params: { field: "active", to: "boolean" } },
        ]);
        expect(result[0]).toMatchObject({ age: 31, active: true });
        expect(runTransform({ d: "2026-01-02" }, [{ type: "convert", params: { field: "d", to: "date" } }]).d).toBe(
            "2026-01-02T00:00:00.000Z"
        );
        expect(() => runTransform({ age: "old" }, [{ type: "convert", params: { field: "age", to: "number" } }])).toThrow(
            /Operation 1 \(convert\): Cannot convert "age"/
        );
    });

    it("runs operations in order and never mutates its input", () => {
        const input = { items: [{ v: "1" }, { v: "5" }] };
        const result = runTransform(input, [
            { type: "convert", params: { field: "items", to: "string" } },
        ]);
        expect(typeof result.items).toBe("string");
        expect(Array.isArray(input.items)).toBe(true);
    });

    it("rejects prototype keys and missing params", () => {
        expect(() => runTransform({}, [{ type: "rename", params: { from: "a", to: "__proto__" } }])).toThrow(/forbidden/);
        expect(() => runTransform({}, [{ type: "select", params: {} }])).toThrow(/needs the "fields"/);
        expect(() => runTransform("text", [{ type: "select", params: { fields: ["a"] } }])).toThrow(/needs an object/);
    });
});
