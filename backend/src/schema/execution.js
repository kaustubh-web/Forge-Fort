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