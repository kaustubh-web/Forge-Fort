import { z } from "zod";
import { keyValue, isBlank } from "./shared.js";

// Log / Output: writes a message to the execution log and becomes part of the final result.
// By the time execute runs, the engine has already resolved {{expressions}} in the config,
// so `message` is final text and each data value has its real type.
export const output = {
    configSchema: z.object({
        message: z.string().max(5000).optional(),
        data: z.array(keyValue).max(50).optional(),
    }),
    requiredFields: (c) => (isBlank(c.message) && !c.data?.length ? ["Message or data"] : []),
    execute: ({ config, log }) => {
        // A message that is a single expression may resolve to a number or object.
        const raw = config.message ?? "";
        const message = typeof raw === "string" ? raw : JSON.stringify(raw);

        // [{ key, value }] -> { key: value }. Object.fromEntries defines own properties
        // (it does not assign), so a key named "__proto__" cannot change the prototype.
        const data = Object.fromEntries((config.data ?? []).map(({ key, value }) => [key, value]));

        if (message) log(message);
        return { output: { message, data } };
    },
};
