import { z } from "zod";
import { retry, isBlank } from "./shared.js";

// AI Text Processing. Only the config schema exists so far: the handler is Phase 4.
export const aiText = {
    configSchema: z.object({
        mode: z.enum(["summarize", "classify", "extract", "generate"]).optional(),
        model: z.string().max(100).optional(),
        instructions: z.string().max(5000).optional(),
        input: z.string().max(20000).optional(), // usually an {{expression}}
        categories: z.array(z.string().max(100)).max(50).optional(),
        jsonSchema: z.string().max(10000).optional(),
        timeoutMs: z.number().int().min(1000).max(120000).optional(),
        retry: retry.optional(),
    }),
    requiredFields: (c) => {
        const missing = [];
        if (!c.mode) missing.push("Mode");
        if (isBlank(c.input)) missing.push("Input");
        if (c.mode === "classify" && !c.categories?.length) missing.push("Categories");
        if (c.mode === "extract" && isBlank(c.jsonSchema)) missing.push("JSON schema");
        return missing;
    },
};
