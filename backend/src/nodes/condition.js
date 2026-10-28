import { z } from "zod";
import { CONDITION_OPERATORS, UNARY_OPERATORS, isBlank } from "./shared.js";
import { compare } from "../engine/compare.js";

// Condition: compares two values and picks the "true" or "false" output handle.
// The engine does not know about conditions: it only sees the returned `branch` and activates
// the edges leaving that handle. The input is passed through unchanged, so the node after the
// Condition works on the same data the Condition looked at.
export const condition = {
    configSchema: z.object({
        left: z.string().max(2000).optional(),
        operator: z.enum(CONDITION_OPERATORS).optional(),
        right: z.string().max(2000).optional(),
    }),
    requiredFields: (c) => {
        const missing = [];
        if (isBlank(c.left)) missing.push("Left value");
        if (!c.operator) missing.push("Operator");
        if (!UNARY_OPERATORS.includes(c.operator) && isBlank(c.right)) missing.push("Right value");
        return missing;
    },
    execute: ({ config, input }) => {
        const result = compare(config.left, config.operator, config.right);
        return { output: input, branch: result ? "true" : "false" };
    },
};
