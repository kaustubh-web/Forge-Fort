import { z } from "zod";
import { keyValue, retry, isBlank } from "./shared.js";

// HTTP Request. Only the config schema exists so far: the handler (with SSRF protection,
// retries and timeouts) is Phase 4. Without `execute`, validateForRun refuses to run it.
export const httpRequest = {
    configSchema: z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
        url: z.string().max(2048).optional(),
        query: z.array(keyValue).max(50).optional(),
        headers: z.array(keyValue).max(50).optional(),
        body: z.string().max(100000).optional(), // JSON text, may contain {{expressions}}
        timeoutMs: z.number().int().min(1000).max(120000).optional(),
        retry: retry.optional(),
    }),
    requiredFields: (c) => (isBlank(c.url) ? ["URL"] : []),
};
