import { describe, it, expect } from "vitest";
import { compare } from "../../src/engine/compare.js";

describe("compare", () => {
    it("equals compares numbers numerically and everything else as text", () => {
        expect(compare(200, "equals", "200")).toBe(true);
        expect(compare("1.0", "equals", 1)).toBe(true);
        expect(compare("abc", "equals", "abc")).toBe(true);
        expect(compare(true, "equals", "true")).toBe(true);
        expect(compare("abc", "notEquals", "abd")).toBe(true);
    });

    it("contains works on text and lists", () => {
        expect(compare("hello world", "contains", "world")).toBe(true);
        expect(compare(["a", 2], "contains", "2")).toBe(true);
        expect(compare(["a"], "contains", "b")).toBe(false);
        expect(() => compare({ a: 1 }, "contains", "a")).toThrow(/text or a list/);
    });

    it("greaterThan / lessThan need numbers", () => {
        expect(compare("10", "greaterThan", 5)).toBe(true);
        expect(compare(3, "lessThan", "2")).toBe(false);
        expect(() => compare("abc", "greaterThan", 1)).toThrow(/needs two numbers/);
        expect(() => compare(undefined, "lessThan", 1)).toThrow(/needs two numbers/);
    });

    it("isEmpty / isNotEmpty", () => {
        for (const empty of [undefined, null, "", "  ", [], {}]) expect(compare(empty, "isEmpty")).toBe(true);
        for (const full of [0, false, "x", [1], { a: 1 }]) expect(compare(full, "isNotEmpty")).toBe(true);
    });

    it("rejects unknown operators", () => {
        expect(() => compare(1, "matches", 1)).toThrow(/Unknown operator/);
    });
});
