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
  MAX_NODES: z.coerce.number().int().positive().default(50),
  MAX_EDGES: z.coerce.number().int().positive().default(100),
  // Engine limits (SPEC section 4). A node's own timeoutMs overrides NODE_TIMEOUT_MS.
  NODE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  WORKFLOW_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300000),
  HTTP_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  HTTP_MAX_REDIRECTS: z.coerce.number().int().min(0).max(20).default(5),
  // Prints run order, edge states and branch/skip decisions (engine/debug.js)
  DEBUG_ENGINE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
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
