import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000), // env vars are strings, coerce makes it a number
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

const result = schema.safeParse(process.env);

if(!result.success){
    console.error("Invalid environment configuration:");
    for(const issue of result.error.issues){
        console.error( `  ${issue.path.join(".")}:${issue.message}`);
    }
    process.exit(1);
}

export const env = result.data;
