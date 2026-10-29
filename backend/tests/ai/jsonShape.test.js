import { describe, it, expect } from "vitest";
import { checkSchema, validateShape } from "../../src/ai/jsonShape.js";

const schema = {
    type: "object",
    required: ["name", "items"],
    properties: {
        name: { type: "string" },
        priority: { enum: ["low", "high"] },
        items: { type: "array", items: { type: "object", required: ["price"], properties: { price: { type: "number" } } } },
        note: { type: ["string", "null"] },
    },
};

describe("checkSchema", () => {
    it("accepts the supported subset", () => {
        expect(checkSchema(schema)).toEqual([]);
    });
    it("reports unsupported keywords, unknown types and wrong shapes", () => {
        expect(checkSchema({ type: "object", pattern: "x" })).toEqual(['schema: "pattern" is not supported (use type, properties, required, items, enum)']);
        expect(checkSchema({ properties: { a: { type: "date" } } })).toEqual(['schema.properties.a: unknown type "date"']);
        expect(checkSchema([])).toEqual(["schema must be an object"]);
        expect(checkSchema({ required: "a" })).toEqual(["schema: required must be an array"]);
    });
});

describe("validateShape", () => {
    it("accepts a matching value", () => {
        expect(validateShape({ name: "A", items: [{ price: 2 }], note: null, priority: "low" }, schema)).toBeNull();
    });
    it.each([
        [{ items: [] }, "$.name is required"],
        [{ name: 1, items: [] }, "$.name should be string, got number"],
        [{ name: "A", items: [{ price: "2" }] }, "$.items[0].price should be number, got string"],
        [{ name: "A", items: [{}] }, "$.items[0].price is required"],
        [{ name: "A", items: [], priority: "mid" }, '$.priority should be one of ["low","high"]'],
        [{ name: "A", items: {} }, "$.items should be array, got object"],
        [[], "$ should be object, got array"],
    ])("explains the first problem %#", (value, problem) => {
        expect(validateShape(value, schema)).toBe(problem);
    });
    it("distinguishes integer from number", () => {
        expect(validateShape(1.5, { type: "integer" })).toBe("$ should be integer, got number");
        expect(validateShape(2, { type: "integer" })).toBeNull();
    });
});
