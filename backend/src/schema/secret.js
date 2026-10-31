import { z } from "zod";

// Names look like env vars (GITHUB_TOKEN), so {{secrets.GITHUB_TOKEN}} reads naturally and the
// name can never contain dots, braces or other characters that would break an expression.
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const name = z.string().regex(SECRET_NAME, "Use A-Z, 0-9 and _, starting with a letter (max 64)");
const value = z.string().min(1, "Value is required").max(4096, "Value is longer than 4096 characters");

export const createSecretSchema = z.object({ name, value });
export const updateSecretSchema = z.object({ value });
