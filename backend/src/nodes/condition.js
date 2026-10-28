import { z } from "zod";
import { CONDITION_OPERATORS, UNARY_OPERATORS, isBlank } from "./shared.js";

// Condition: compares two values and picks the "true" or "false" output handle.
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
};
