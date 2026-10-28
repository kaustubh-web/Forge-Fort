import { z } from "zod";
import { keyValue, isBlank } from "./shared.js";

// Log / Output: writes a message to the execution log and becomes part of the final result.
export const output = {
    configSchema: z.object({
        message: z.string().max(5000).optional(),
        data: z.array(keyValue).max(50).optional(),
    }),
    requiredFields: (c) => (isBlank(c.message) && !c.data?.length ? ["Message or data"] : []),
};
