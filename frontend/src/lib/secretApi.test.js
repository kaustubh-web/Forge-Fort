import { describe, it, expect } from "vitest";
import { secretNameProblem, secretExpression } from "@/lib/secretApi";

describe("secretNameProblem", () => {
  it("accepts env-var style names", () => {
    for (const name of ["A", "GITHUB_TOKEN", "API_KEY_2", "X".repeat(64)]) expect(secretNameProblem(name), name).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(secretNameProblem("")).toBe("Name is required");
    for (const name of ["lower", "1ABC", "_ABC", "HAS-DASH", "HAS.DOT", "X".repeat(65)]) {
      expect(secretNameProblem(name), name).toMatch(/A-Z, 0-9 and _/);
    }
  });
});

it("secretExpression", () => {
  expect(secretExpression("API_KEY")).toBe("{{secrets.API_KEY}}");
});
