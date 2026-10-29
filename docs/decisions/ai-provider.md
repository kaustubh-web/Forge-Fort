# Decision: AI provider integration for the AI Text node

## Problem
The AI node must call Gemini or OpenAI (chosen by env vars), support summarize / classify / extract / generate, validate what the model returns, honour cancellation and timeouts, and never expose API keys.

## Options considered
| Option | License (checked 2026-10-29) | Notes |
|---|---|---|
| Official SDKs: [`@google/genai`](https://github.com/googleapis/js-genai), [`openai`](https://github.com/openai/openai-node) | Apache-2.0, both published in the last week | Maintained by the vendors. Both accept an `AbortSignal` and expose the HTTP status on errors. The SPEC asks for the official SDKs. |
| A multi-provider wrapper (e.g. Vercel AI SDK) | Apache-2.0 | One API for many providers, but a large dependency and another layer to explain, for two providers. |
| Raw `fetch` to each REST API | n/a | No dependency, but we would re-implement request/response formats and error parsing per vendor. |

## Choice
The two official SDKs behind a tiny adapter interface (`backend/src/ai/`):
```
complete({ model, system, prompt, json, signal }) -> Promise<string>
```
- `provider.js` picks the adapter from `AI_PROVIDER` on first use. Adding a provider = one file + one line.
- SDK-level retries are off (`maxRetries: 0` for OpenAI; no `retryOptions` for Gemini, whose default is no retry). The engine is the only retry layer, so attempts are counted once and shown in the execution log.
- `errors.js` maps SDK errors: 429/5xx/network -> retryable; 401/403 -> "rejected the API key"; other 4xx -> final.
- JSON mode (`response_format: json_object` / `responseMimeType: application/json`) for classify and extract, then our own checks: category must be in the list; extract output must match the user's schema.
- Malformed output is re-asked up to `AI_OUTPUT_RETRIES` times with the exact problem, then the node fails.

### Schema validation for extract
ajv (MIT) was considered and rejected: it compiles schemas into JavaScript with `new Function`, and these schemas are user input (CLAUDE.md forbids that). `ai/jsonShape.js` checks a documented subset (`type`, `properties`, `required`, `items`, `enum`) by walking the schema as data.

## Configuration
`AI_PROVIDER` (gemini | openai, optional), `GEMINI_API_KEY` / `OPENAI_API_KEY`, `AI_MODEL` (required when a provider is set; copy it from the vendor's model list, not hard-coded because model ids change often), `AI_OUTPUT_RETRIES` (default 2). Validated at startup in `config/env.js`. Keys are read only by the adapters and never logged or returned.

## What was borrowed
Nothing copied. Usage follows the SDKs' own documentation and type definitions.

## Risks
- Prompt injection: user data is wrapped in `<input>` tags and the system prompt says it is data only. This reduces, but does not remove, the risk. The node has no tools, so the worst case is a wrong text answer.
- Cost: input is capped at 20,000 characters; a bad-output loop is bounded (max 3 calls per attempt, 3 attempts = 9 calls worst case).
- Aborting a call stops our wait and closes the connection, but the provider may still bill for work it already did (noted in the Gemini SDK docs).
