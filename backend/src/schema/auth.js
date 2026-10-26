import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Invalid email"));

export const registerSchema = z.object({
  email,
  
  password: z.string().min(8, "At least 8 characters").max(72, "At most 72 characters"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(72),
});
