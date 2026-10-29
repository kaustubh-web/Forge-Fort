import { GoogleGenAI } from "@google/genai";
import { toAiNodeError } from "./errors.js";

// Google Gemini through the official SDK (@google/genai, Apache-2.0).
// The SDK only retries when `retryOptions` is given. We never give it: the engine owns retries,
// and two retry layers would multiply (3 engine attempts x 5 SDK attempts = 15 calls).
export function createGeminiProvider({ apiKey }) {
    const client = new GoogleGenAI({ apiKey });

    return {
        name: "gemini",
        async complete({ model, system, prompt, json, signal }) {
            try {
                const response = await client.models.generateContent({
                    model,
                    contents: prompt,
                    config: {
                        systemInstruction: system,
                        // JSON mode: the model must reply with JSON only (classify, extract).
                        responseMimeType: json ? "application/json" : "text/plain",
                        abortSignal: signal, // closes the HTTP call on Stop / timeout
                    },
                });
                return response.text ?? "";
            } catch (error) {
                throw toAiNodeError("Gemini", error, signal);
            }
        },
    };
}
