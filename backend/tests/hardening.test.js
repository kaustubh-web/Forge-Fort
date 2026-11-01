import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import { runWorkflow } from "../src/engine/runWorkflow.js";
import { nodeRegistry } from "../src/nodes/registry.js";
import { NodeError } from "../src/engine/errors.js";
import { createHttpRequestHandler } from "../src/nodes/httpRequest.js";
import { node, edge, workflow, trigger, output } from "./engine/fixtures.js";

// Findings from the Phase 6 security review, one describe each.

const realHttpExecute = nodeRegistry.httpRequest.execute;
afterEach(() => {
    nodeRegistry.httpRequest.execute = realHttpExecute;
    env.DEBUG_ENGINE = false;
    vi.restoreAllMocks();
});

describe("secrets never reach the server console", () => {
    const SECRET = "sk_live_console_leak_1234";
    const wf = () =>
        workflow(
            [
                trigger(),
                node("http", "httpRequest", {
                    url: "https://api.example.com/?key={{secrets.API_KEY}}",
                    retry: { maxAttempts: 2, backoffMs: 1 },
                }),
                output("out", "done"),
            ],
            [edge("trigger", "http"), edge("http", "out")]
        );

    // Everything written to console.log / console.error during the run, as one string.
    function captureConsole() {
        const lines = [];
        const keep = (...args) => lines.push(args.map(String).join(" "));
        vi.spyOn(console, "log").mockImplementation(keep);
        vi.spyOn(console, "error").mockImplementation(keep);
        return () => lines.join("\n");
    }

    it("debug lines for retries and failures are redacted", async () => {
        env.DEBUG_ENGINE = true;
        nodeRegistry.httpRequest.execute = ({ config }) => {
            throw new NodeError(`Request to ${config.url} failed`, { retryable: true });
        };
        const output = captureConsole();
        const result = await runWorkflow({ workflow: wf(), secrets: { API_KEY: SECRET } });

        expect(result.status).toBe("failed");
        expect(output()).toContain("attempt 1 failed");
        expect(output()).toContain("[REDACTED]");
        expect(output()).not.toContain(SECRET);
    });

    it("the stack of an unexpected error is redacted", async () => {
        nodeRegistry.httpRequest.execute = ({ config }) => {
            throw new TypeError(`bug while calling ${config.url}`);
        };
        const output = captureConsole();
        await runWorkflow({ workflow: wf(), secrets: { API_KEY: SECRET } });

        expect(output()).toContain("[engine] unexpected error in http");
        expect(output()).not.toContain(SECRET);
    });
});

describe("passwords are limited to bcrypt's 72 bytes, not 72 characters", () => {
    const register = (password) => request(app).post("/api/auth/register").send({ email: `p${Math.random()}@test.com`, password });

    it("accepts 72 ASCII characters (72 bytes)", async () => {
        expect((await register("a".repeat(72))).status).toBe(201);
    });

    it("rejects 40 accented characters (80 bytes) that a character count would allow", async () => {
        const res = await register("é".repeat(40));
        expect(res.status).toBe(400);
        expect(res.body.error.details[0].message).toMatch(/at most 72 bytes/);
    });
});

describe("HTTP header names and values that cannot be sent", () => {
    const fetchImpl = vi.fn();
    const execute = createHttpRequestHandler(fetchImpl);
    const call = (headers) => execute({ config: { url: "https://x.test/", headers }, signal: new AbortController().signal });

    it("a line break in a value fails once, clearly, without calling fetch", async () => {
        const error = await call([{ key: "X-Note", value: "a\r\nInjected: yes" }]).catch((e) => e);
        expect(error).toBeInstanceOf(NodeError);
        expect(error.retryable).toBeFalsy();
        expect(error.message).toBe('Header "X-Note" contains a line break or null character');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a header name with spaces or colons is refused", async () => {
        for (const key of ["Bad Name", "X:Y", "Wörd"]) {
            const error = await call([{ key, value: "v" }]).catch((e) => e);
            expect(error.message, key).toMatch(/has characters that are not allowed/);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
