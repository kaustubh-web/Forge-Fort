import { z } from "zod";

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

// Transform Data: reshapes its input with an ordered list of predefined operations.
export const transform = {
    configSchema: z.object({
        operations: z.array(transformOperation).max(50).optional(),
    }),
    requiredFields: (c) => (c.operations?.length ? [] : ["At least one operation"]),
};
