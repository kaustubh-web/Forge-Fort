import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Invalid email"));

export const registerSchema = z.object({
  email,
  
  // bcrypt only uses the first 72 BYTES. Accented and non-Latin characters take 2-4 bytes each,
  // so a 72-character limit is not enough: the rest would be silently ignored, and two long
  // passwords sharing the first 72 bytes would both log in. Count bytes instead.
  password: z
    .string()
    .min(8, "At least 8 characters")
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Too long: at most 72 bytes (fewer characters if you use accents or non-Latin letters)"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(72),
});
