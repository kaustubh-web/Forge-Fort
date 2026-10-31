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
  API_RATE_LIMIT: z.coerce.number().int().positive().default(600), // per IP per 15 min, all /api routes
  EXECUTE_RATE_LIMIT: z.coerce.number().int().positive().default(30), // runs started per user per minute
  MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(3), // running at once, per user
  // Proxy hops in front of the app (0 locally, 1 behind Render/Railway/Heroku). Express then takes
  // the client IP from X-Forwarded-For, so rate limits see real users instead of the proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  MAX_NODES: z.coerce.number().int().positive().default(50),
  MAX_EDGES: z.coerce.number().int().positive().default(100),
  // Engine limits (SPEC section 4). A node's own timeoutMs overrides NODE_TIMEOUT_MS.
  NODE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  WORKFLOW_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300000),
  HTTP_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  HTTP_MAX_REDIRECTS: z.coerce.number().int().min(0).max(20).default(5),
  // Prints run order, edge states and branch/skip decisions (engine/debug.js)
  DEBUG_ENGINE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // AI provider (optional). Unset = the server runs, AI nodes fail with "not configured".
  // An empty line in .env (AI_PROVIDER=) counts as unset.
  AI_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["gemini", "openai"]).optional()),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(), // default model id; a node's own "model" overrides it
  AI_OUTPUT_RETRIES: z.coerce.number().int().min(0).max(5).default(2), // re-asks after malformed output
}).superRefine((env, ctx) => {
  // A chosen provider must be usable: fail at startup, not on the first run.
  const keyName = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY" }[env.AI_PROVIDER];
  if (keyName && !env[keyName]) ctx.addIssue({ code: "custom", path: [keyName], message: `required when AI_PROVIDER=${env.AI_PROVIDER}` });
  if (env.AI_PROVIDER && !env.AI_MODEL) ctx.addIssue({ code: "custom", path: ["AI_MODEL"], message: "required when AI_PROVIDER is set" });
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
