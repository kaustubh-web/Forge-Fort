import { describe, it, expect, vi, beforeEach } from "vitest";

// Both SDKs are replaced with fakes, so these tests check how we CALL them (model, prompts,
// JSON mode, abort signal, retries off) and how we map their errors. No network.
const sdk = vi.hoisted(() => ({
    openaiOptions: null,
    openaiCreate: vi.fn(),
    geminiGenerate: vi.fn(),
}));

vi.mock("openai", () => ({
    default: class {
        constructor(options) {
            sdk.openaiOptions = options;
        }
        chat = { completions: { create: sdk.openaiCreate } };
    },
}));
vi.mock("@google/genai", () => ({
    GoogleGenAI: class {
        models = { generateContent: sdk.geminiGenerate };
    },
}));

const { createOpenAiProvider } = await import("../../src/ai/openai.js");
const { createGeminiProvider } = await import("../../src/ai/gemini.js");
const { createProviderFromEnv } = await import("../../src/ai/provider.js");
const { toAiNodeError } = await import("../../src/ai/errors.js");

const request = (signal = new AbortController().signal) => ({ model: "m1", system: "sys", prompt: "hello", json: true, signal });

beforeEach(() => {
    sdk.openaiCreate.mockReset();
    sdk.geminiGenerate.mockReset();
});

describe("OpenAI adapter", () => {
    it("turns SDK retries off and sends system + user messages, JSON mode and the signal", async () => {
        sdk.openaiCreate.mockResolvedValue({ choices: [{ message: { content: '{"a":1}' } }] });
        const provider = createOpenAiProvider({ apiKey: "sk-test" });
        const req = request();

        expect(await provider.complete(req)).toBe('{"a":1}');
        expect(sdk.openaiOptions).toEqual({ apiKey: "sk-test", maxRetries: 0 });
        const [body, options] = sdk.openaiCreate.mock.calls[0];
        expect(body).toEqual({
            model: "m1",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "hello" },
            ],
            response_format: { type: "json_object" },
        });
        expect(options.signal).toBe(req.signal);
    });

    it("maps a 429 to a retryable NodeError", async () => {
        sdk.openaiCreate.mockRejectedValue(Object.assign(new Error("Rate limit"), { status: 429 }));
        const error = await createOpenAiProvider({ apiKey: "k" }).complete(request()).catch((e) => e);
        expect(error.name).toBe("NodeError");
        expect(error.retryable).toBe(true);
    });
});

describe("Gemini adapter", () => {
    it("sends the system instruction, JSON mime type and abort signal", async () => {
        sdk.geminiGenerate.mockResolvedValue({ text: "done" });
        const req = { ...request(), json: false };

        expect(await createGeminiProvider({ apiKey: "g" }).complete(req)).toBe("done");
        expect(sdk.geminiGenerate).toHaveBeenCalledWith({
            model: "m1",
            contents: "hello",
            config: { systemInstruction: "sys", responseMimeType: "text/plain", abortSignal: req.signal },
        });
    });

    it("maps a 401 to a non-retryable key error", async () => {
        sdk.geminiGenerate.mockRejectedValue(Object.assign(new Error("API key not valid"), { status: 401 }));
        const error = await createGeminiProvider({ apiKey: "g" }).complete(request()).catch((e) => e);
        expect(error.message).toBe("Gemini rejected the API key (HTTP 401)");
        expect(error.retryable).toBe(false);
    });
});

describe("provider selection and error mapping", () => {
    it("picks the provider named by AI_PROVIDER and carries AI_MODEL", () => {
        expect(createProviderFromEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_MODEL: "x" })).toMatchObject({ name: "openai", defaultModel: "x" });
        expect(createProviderFromEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "y" })).toMatchObject({ name: "gemini", defaultModel: "y" });
    });

    it.each([
        [{ status: 503 }, true],
        [{ status: 500 }, true],
        [{ status: 429 }, true],
        [{ status: 404 }, false],
        [{ status: 400 }, false],
        [{ status: 403 }, false],
        [{}, true], // no status = network error
    ])("%j -> retryable %s", (props, retryable) => {
        expect(toAiNodeError("X", Object.assign(new Error("e"), props)).retryable).toBe(retryable);
    });

    it("passes an abort through untouched so the engine can name the reason", () => {
        const controller = new AbortController();
        controller.abort();
        const abort = new Error("aborted");
        expect(toAiNodeError("X", abort, controller.signal)).toBe(abort);
    });
});
