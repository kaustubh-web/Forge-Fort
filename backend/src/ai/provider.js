import { env } from "../config/env.js";
import { NodeError } from "../engine/errors.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAiProvider } from "./openai.js";

// Picks the AI provider from env vars (docs/decisions/ai-provider.md).
//
// Every provider has the same small interface, so aiText.js never knows which one it talks to:
//   complete({ model, system, prompt, json, signal }) -> Promise<string>
//     system  our instructions for the model
//     prompt  the user's instructions plus their data
//     json    ask the provider for a JSON-only reply (classify, extract)
//     signal  aborts the HTTP call (Stop / timeout)
// Adding a provider = one file with that function + one line in PROVIDERS.

const PROVIDERS = {
    gemini: (config) => createGeminiProvider({ apiKey: config.GEMINI_API_KEY }),
    openai: (config) => createOpenAiProvider({ apiKey: config.OPENAI_API_KEY }),
};

// `config` is the env by default; tests pass their own so a real key in .env is never used.
export function createProviderFromEnv(config = env) {
    if (!config.AI_PROVIDER) {
        throw new NodeError("AI provider not configured: set AI_PROVIDER, its API key and AI_MODEL in backend/.env");
    }
    return { ...PROVIDERS[config.AI_PROVIDER](config), defaultModel: config.AI_MODEL };
}

// One client for the whole process, created on first use.
let provider;
export function getAiProvider() {
    provider ??= createProviderFromEnv();
    return provider;
}
