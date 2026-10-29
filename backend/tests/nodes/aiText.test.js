import { describe, it, expect, afterEach } from "vitest";
import { createAiTextHandler, aiText, MAX_INPUT_CHARS } from "../../src/nodes/aiText.js";
import { createProviderFromEnv } from "../../src/ai/provider.js";
import { NodeError } from "../../src/engine/errors.js";
import { runWorkflow } from "../../src/engine/runWorkflow.js";
import { validateForRun } from "../../src/engine/validateForRun.js";
import { nodeRegistry } from "../../src/nodes/registry.js";
import { node, edge, workflow, trigger, output, condition } from "../engine/fixtures.js";

// A fake provider: answers from a queue (strings, or errors to throw) and records every call.
// No real AI is ever called in tests.
function fakeProvider(...replies) {
    const calls = [];
    return {
        calls,
        defaultModel: "fake-model",
        async complete(request) {
            calls.push(request);
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;
            return reply;
        },
    };
}

async function run(provider, config) {
    const logs = [];
    const execute = createAiTextHandler(() => provider);
    const result = await execute({ config, signal: new AbortController().signal, log: (m) => logs.push(m) });
    return { ...result, logs };
}
const rejection = (promise) => promise.then(() => { throw new Error("expected a rejection"); }, (e) => e);

describe("aiText: modes", () => {
    it("summarize: sends instructions and delimited input, returns { text }", async () => {
        const provider = fakeProvider("  Short summary.  ");
        const { output } = await run(provider, { mode: "summarize", instructions: "One sentence.", input: "Long text" });

        expect(output).toEqual({ text: "Short summary." });
        const [call] = provider.calls;
        expect(call.model).toBe("fake-model");
        expect(call.json).toBe(false);
        expect(call.prompt).toBe("One sentence.\n\n<input>\nLong text\n</input>");
        expect(call.system).toContain("not instructions");
    });

    it("generate: returns { text } and uses the node's model over the default", async () => {
        const provider = fakeProvider("A haiku");
        const { output } = await run(provider, { mode: "generate", model: "custom", input: "Write a haiku about rain" });
        expect(output).toEqual({ text: "A haiku" });
        expect(provider.calls[0].model).toBe("custom");
    });

    it("classify: asks for JSON and returns the configured spelling", async () => {
        const provider = fakeProvider('{"category":"positive"}');
        const { output } = await run(provider, { mode: "classify", input: "I love it", categories: ["Positive", "Negative"] });
        expect(output).toEqual({ category: "Positive" });
        expect(provider.calls[0].json).toBe(true);
        expect(provider.calls[0].system).toContain('["Positive","Negative"]');
    });

    it("extract: returns { data } that matches the schema (code fences tolerated)", async () => {
        const provider = fakeProvider('```json\n{"name":"Ann","age":31}\n```');
        const jsonSchema = JSON.stringify({ type: "object", required: ["name"], properties: { name: { type: "string" }, age: { type: "integer" } } });
        const { output } = await run(provider, { mode: "extract", input: "Ann is 31", jsonSchema });
        expect(output).toEqual({ data: { name: "Ann", age: 31 } });
    });

    it("sends an object input (whole-string expression) as pretty JSON", async () => {
        const provider = fakeProvider("ok");
        await run(provider, { mode: "summarize", input: { title: "x" } });
        expect(provider.calls[0].prompt).toContain('{\n  "title": "x"\n}');
    });

    it("cuts very long input and says so in the log", async () => {
        const provider = fakeProvider("ok");
        const { logs } = await run(provider, { mode: "summarize", input: "a".repeat(MAX_INPUT_CHARS + 500) });
        expect(provider.calls[0].prompt).toHaveLength(MAX_INPUT_CHARS + "<input>\n\n</input>".length);
        expect(logs[0]).toContain("cut");
    });
});

describe("aiText: bad output", () => {
    it("re-asks with the problem after a wrong category, then succeeds", async () => {
        const provider = fakeProvider('{"category":"Neutral"}', '{"category":"Negative"}');
        const { output, logs } = await run(provider, { mode: "classify", input: "meh", categories: ["Positive", "Negative"] });

        expect(output).toEqual({ category: "Negative" });
        expect(provider.calls).toHaveLength(2);
        expect(provider.calls[1].prompt).toContain('rejected because "Neutral" is not one of ["Positive","Negative"]');
        expect(logs).toEqual(['AI reply rejected (try 1 of 3): "Neutral" is not one of ["Positive","Negative"]']);
    });

    it("fails with a clear, non-retryable error after AI_OUTPUT_RETRIES re-asks", async () => {
        const provider = fakeProvider('{"x":1}', '{"x":1}', '{"x":1}', "never used");
        const jsonSchema = JSON.stringify({ type: "object", required: ["name"] });
        const error = await rejection(run(provider, { mode: "extract", input: "text", jsonSchema }));

        expect(provider.calls).toHaveLength(3);
        expect(error).toBeInstanceOf(NodeError);
        expect(error.retryable).toBe(false);
        expect(error.message).toBe("The AI reply was invalid 3 times. Last problem: the JSON does not match the schema: $.name is required");
    });

    it("rejects non-JSON and empty replies", async () => {
        const error = await rejection(run(fakeProvider("nope", "nope", "nope"), { mode: "classify", input: "x", categories: ["A"] }));
        expect(error.message).toContain("not valid JSON");
        const empty = await rejection(run(fakeProvider("", " ", ""), { mode: "summarize", input: "x" }));
        expect(empty.message).toContain("the reply was empty");
    });
});

describe("aiText: setup errors", () => {
    it("fails clearly when no provider is configured", () => {
        expect(() => createProviderFromEnv({})).toThrow("AI provider not configured");
    });
    it("fails when there is no model", async () => {
        const provider = { ...fakeProvider("x"), defaultModel: undefined };
        expect((await rejection(run(provider, { mode: "summarize", input: "x" }))).message).toContain("No AI model");
    });
    it("fails when the input resolves to nothing", async () => {
        expect((await rejection(run(fakeProvider("x"), { mode: "summarize", input: "" }))).message).toBe("Input is empty");
    });
    it("checkConfig rejects an extract schema that is not JSON or uses unsupported keywords", () => {
        expect(aiText.checkConfig({ mode: "extract", jsonSchema: "{bad" })[0]).toContain("not valid JSON");
        expect(aiText.checkConfig({ mode: "extract", jsonSchema: '{"type":"object","$ref":"#"}' })).toEqual([
            'JSON schema: "$ref" is not supported (use type, properties, required, items, enum)',
        ]);
        expect(aiText.checkConfig({ mode: "summarize" })).toEqual([]);
    });
    it("validateForRun reports a bad extract schema before anything runs", () => {
        const wf = workflow([trigger(), node("ai", "aiText", { mode: "extract", input: "x", jsonSchema: "[1" })], [edge("trigger", "ai")]);
        const error = (() => { try { validateForRun(wf); } catch (e) { return e; } })();
        expect(error.details.map((d) => d.message).join()).toContain('Node "ai": JSON schema is not valid JSON');
    });
});

// The real engine with the AI node using a fake provider.
describe("AI node inside a workflow", () => {
    const original = nodeRegistry.aiText.execute;
    afterEach(() => {
        nodeRegistry.aiText.execute = original;
    });

    const flow = () =>
        workflow(
            [
                trigger(),
                node("ai", "aiText", { mode: "classify", input: "{{input.review}}", categories: ["Positive", "Negative"], retry: { maxAttempts: 3, backoffMs: 1 } }),
                condition("good", "{{nodes.ai.output.category}}", "equals", "Positive"),
                output("thanks", "Thanks!"),
                output("sorry", "Sorry to hear that"),
            ],
            [edge("trigger", "ai"), edge("ai", "good"), edge("good", "thanks", "true"), edge("good", "sorry", "false")]
        );

    it("the engine retries a rate-limited call, then the Condition branches on the category", async () => {
        const provider = fakeProvider(new NodeError("Gemini error (HTTP 429): slow down", { retryable: true }), '{"category":"Negative"}');
        nodeRegistry.aiText.execute = createAiTextHandler(() => provider);
        const result = await runWorkflow({ workflow: flow(), input: { review: "Broke after a day" } });
        const ai = result.nodes.find((r) => r.nodeId === "ai");

        expect(result.status).toBe("completed");
        expect(ai.attempts).toBe(2);
        expect(ai.output).toEqual({ category: "Negative" });
        expect(provider.calls[1].prompt).toContain("Broke after a day");
        expect(Object.keys(result.outputs)).toEqual(["sorry"]);
    });

    it("Stop aborts the signal the provider received", async () => {
        const controller = new AbortController();
        let received;
        nodeRegistry.aiText.execute = createAiTextHandler(() => ({
            defaultModel: "m",
            complete: ({ signal }) => {
                received = signal;
                setTimeout(() => controller.abort(), 10);
                return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
            },
        }));
        const result = await runWorkflow({ workflow: flow(), input: { review: "x" }, signal: controller.signal });

        expect(received.aborted).toBe(true);
        expect(result.status).toBe("cancelled");
    });
});
