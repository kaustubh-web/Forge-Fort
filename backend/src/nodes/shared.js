import { z } from "zod";

// Schema pieces used by more than one node type.

export const keyValue = z.object({
    key: z.string().max(200),
    value: z.string().max(5000),
});

export const retry = z.object({
    maxAttempts: z.number().int().min(1).max(5),
    backoffMs: z.number().int().min(0).max(60000),
});

export const CONDITION_OPERATORS = [
    "equals",
    "notEquals",
    "contains",
    "greaterThan",
    "lessThan",
    "isEmpty",
    "isNotEmpty",
];

// isEmpty / isNotEmpty only look at the left side, so they need no right value.
export const UNARY_OPERATORS = ["isEmpty", "isNotEmpty"];

// "" or only whitespace counts as not filled in.
export const isBlank = (value) => typeof value !== "string" || value.trim() === "";
