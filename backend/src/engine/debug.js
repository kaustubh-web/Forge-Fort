import { env } from "../config/env.js";

// Engine debug logging, off by default. Run with DEBUG_ENGINE=true to see the run order,
// every edge-state change and every run/skip decision.
export function debug(...args) {
    if (env.DEBUG_ENGINE) console.log("[engine]", ...args);
}
