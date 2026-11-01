import {z} from "zod";

const MAX_INPUT_CHARS = 100_000;

export const executeSchema = z
      .object({
        input : z
               .record(z.string(),z.unknown())
               .default({})
               .refine((value)=> JSON.stringify(value).length <= MAX_INPUT_CHARS, "Input is larger than 100 KB"),
      })

      .default({input:{}});

// GET /api/executions?status=failed&limit=50 (query strings arrive as text, so limit is coerced).
export const listExecutionsQuery = z.object({
    status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
