import { z } from "zod";

// Node registry (SPEC section 6): one entry per node type.
// Today an entry only has a configSchema. Phase 3-4 adds the execute handler and output shape,
// so adding a node later means adding one entry here (plus its handler file).
//
// Schemas are lenient on purpose: every field is optional so an unfinished draft can be saved.
// "Required field" checks happen before a run. Unknown keys are stripped by Zod,
// so only known, size-limited fields ever reach MongoDB.

const keyValue = z.object({
    key: z.string().max(200),
    value: z.string().max(5000),
});

const retry = z.object({
    maxAttempts: z.number().int().min(1).max(5),
    backoffMs: z.number().int().min(0).max(60000),
});

// A transform operation is a type plus a few simple parameters. No user code, ever.
const transformOperation = z.object({
    type: z.enum(["select", "rename", "filter", "map", "merge", "convert"]),
    params: z
        .record(
            z.string().max(100),
            z.union([
                z.string().max(2000),
                z.number(),
                z.boolean(),
                z.array(z.string().max(500)).max(100),
            ])
        )
        .default({}),
});

export const nodeRegistry = {
    manualTrigger: {
        configSchema: z.object({}),
    },
    httpRequest: {
        configSchema: z.object({
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
            url: z.string().max(2048).optional(),
            query: z.array(keyValue).max(50).optional(),
            headers: z.array(keyValue).max(50).optional(),
            body: z.string().max(100000).optional(), // JSON text, may contain {{expressions}}
            timeoutMs: z.number().int().min(1000).max(120000).optional(),
            retry: retry.optional(),
        }),
    },
    aiText: {
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
    },
    condition: {
        configSchema: z.object({
            left: z.string().max(2000).optional(),
            operator: z
                .enum([
                    "equals",
                    "notEquals",
                    "contains",
                    "greaterThan",
                    "lessThan",
                    "isEmpty",
                    "isNotEmpty",
                ])
                .optional(),
            right: z.string().max(2000).optional(),
        }),
    },
    transform: {
        configSchema: z.object({
            operations: z.array(transformOperation).max(50).optional(),
        }),
    },
    output: {
        configSchema: z.object({
            message: z.string().max(5000).optional(),
            data: z.array(keyValue).max(50).optional(),
        }),
    },
};

export const NODE_TYPES = Object.keys(nodeRegistry);
