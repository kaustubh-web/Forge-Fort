import OpenAI from "openai";
import { toAiNodeError } from "./errors.js";

// OpenAI through the official SDK (openai, Apache-2.0).
// maxRetries: 0 because the SDK retries twice by default, and the engine already retries
// transient errors with its own backoff (one retry layer, visible in the execution log).
export function createOpenAiProvider({ apiKey }) {
    const client = new OpenAI({ apiKey, maxRetries: 0 });

    return {
        name: "openai",
        async complete({ model, system, prompt, json, signal }) {
            try {
                const completion = await client.chat.completions.create(
                    {
                        model,
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: prompt },
                        ],
                        // JSON mode: the reply is guaranteed to be a JSON object (classify, extract).
                        ...(json && { response_format: { type: "json_object" } }),
                    },
                    { signal } // closes the HTTP call on Stop / timeout
                );
                return completion.choices[0]?.message?.content ?? "";
            } catch (error) {
                throw toAiNodeError("OpenAI", error, signal);
            }
        },
    };
}
