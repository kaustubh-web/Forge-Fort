import { describe, it, expect, afterEach } from "vitest";
import { backoffDelay, sleep, raceAbort, MAX_BACKOFF_MS } from "../../src/engine/retry.js";
import { runWorkflow } from "../../src/engine/runWorkflow.js";
import { NodeError } from "../../src/engine/errors.js";
import { nodeRegistry } from "../../src/nodes/registry.js";
import { node, edge, workflow, trigger, output } from "./fixtures.js";

const rejection = (promise) => promise.then(() => { throw new Error("expected a rejection"); }, (e) => e);
const record = (result, id) => result.nodes.find((r) => r.nodeId === id);
const statuses = (result) => Object.fromEntries(result.nodes.map((r) => [r.nodeId, r.status]));

describe("backoffDelay", () => {
    it("doubles after every attempt", () => {
        expect([1, 2, 3, 4].map((a) => backoffDelay(a, 1000))).toEqual([1000, 2000, 4000, 8000]);
    });
    it("waits at least as long as Retry-After asks", () => {
        expect(backoffDelay(1, 1000, 5000)).toBe(5000);
        expect(backoffDelay(3, 1000, 500)).toBe(4000);
    });
    it("never waits longer than the cap", () => {
        expect(backoffDelay(10, 1000)).toBe(MAX_BACKOFF_MS);
        expect(backoffDelay(1, 0, 10 * 60 * 1000)).toBe(MAX_BACKOFF_MS);
    });
});

describe("sleep and raceAbort", () => {
    it("sleep ends early with the abort reason", async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("stop")), 10);
        const started = Date.now();
        expect((await rejection(sleep(5000, controller.signal))).message).toBe("stop");
        expect(Date.now() - started).toBeLessThan(1000);
    });
    it("raceAbort stops waiting for a promise that never settles", async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("stop")), 10);
        expect((await rejection(raceAbort(new Promise(() => {}), controller.signal))).message).toBe("stop");
    });
    it("raceAbort passes a normal result through", async () => {
        expect(await raceAbort(Promise.resolve(42), new AbortController().signal)).toBe(42);
    });
});

// The engine side. The HTTP node type is used with a fake handler, so these tests only exercise
// the retry/timeout/cancel logic in executeNode, not the network.
describe("runWorkflow: retries, timeouts, cancellation", () => {
    const original = nodeRegistry.httpRequest.execute;
    const originalRetry = nodeRegistry.httpRequest.defaultRetry;
    afterEach(() => {
        nodeRegistry.httpRequest.execute = original;
        nodeRegistry.httpRequest.defaultRetry = originalRetry;
    });

    // Trigger -> call (fake HTTP handler) -> out
    const flow = (config = {}) =>
        workflow(
            [trigger(), node("call", "httpRequest", { url: "https://example.com", ...config }), output("out", "done")],
            [edge("trigger", "call"), edge("call", "out")]
        );
    const fast = { maxAttempts: 3, backoffMs: 1 };

    it("retries a transient error and then succeeds", async () => {
        let calls = 0;
        nodeRegistry.httpRequest.execute = async () => {
            calls += 1;
            if (calls < 3) throw new NodeError("HTTP 503", { retryable: true });
            return { output: { ok: true } };
        };
        const result = await runWorkflow({ workflow: flow({ retry: fast }) });

        expect(result.status).toBe("completed");
        expect(record(result, "call").attempts).toBe(3);
        expect(record(result, "call").attemptLog).toEqual([
            { attempt: 1, error: "HTTP 503", waitMs: 1 },
            { attempt: 2, error: "HTTP 503", waitMs: 2 },
        ]);
    });

    it("does not retry a non-retryable error", async () => {
        let calls = 0;
        nodeRegistry.httpRequest.execute = async () => {
            calls += 1;
            throw new NodeError("HTTP 404");
        };
        const result = await runWorkflow({ workflow: flow({ retry: fast }) });

        expect(calls).toBe(1);
        expect(result.status).toBe("failed");
        expect(record(result, "call").error).toBe("HTTP 404");
        expect(record(result, "out").skipReason).toBe("upstream failed");
    });

    it("gives up after maxAttempts and keeps the last error", async () => {
        nodeRegistry.httpRequest.execute = async () => {
            throw new NodeError("HTTP 502", { retryable: true });
        };
        const result = await runWorkflow({ workflow: flow({ retry: fast }) });

        expect(result.status).toBe("failed");
        expect(record(result, "call").attempts).toBe(3);
        expect(record(result, "call").attemptLog.at(-1)).toEqual({ attempt: 3, error: "HTTP 502", waitMs: null });
    });

    it("uses the node type's default retry policy when the config has none", async () => {
        nodeRegistry.httpRequest.defaultRetry = { maxAttempts: 2, backoffMs: 1 };
        let calls = 0;
        nodeRegistry.httpRequest.execute = async () => {
            calls += 1;
            throw new NodeError("down", { retryable: true });
        };
        await runWorkflow({ workflow: flow() });
        expect(calls).toBe(2);
    });

    it("times out a handler that ignores its signal, and retries the timeout", async () => {
        let calls = 0;
        nodeRegistry.httpRequest.execute = () => {
            calls += 1;
            return new Promise(() => {}); // hangs forever and never looks at the signal
        };
        const result = await runWorkflow({ workflow: flow({ retry: { maxAttempts: 2, backoffMs: 1 } }), limits: { nodeTimeoutMs: 30 } });

        expect(calls).toBe(2);
        expect(result.status).toBe("failed");
        expect(record(result, "call").error).toBe("Timed out after 30 ms");
    });

    it("passes an AbortSignal that fires on timeout into the handler", async () => {
        let seen;
        nodeRegistry.httpRequest.execute = ({ signal }) =>
            new Promise((_, reject) => {
                seen = signal;
                signal.addEventListener("abort", () => reject(signal.reason));
            });
        await runWorkflow({ workflow: flow(), limits: { nodeTimeoutMs: 20 } });
        expect(seen.aborted).toBe(true);
    });

    it("cancels a node mid-call: node failed 'Cancelled', the rest skipped, execution cancelled", async () => {
        const controller = new AbortController();
        let calls = 0;
        nodeRegistry.httpRequest.execute = ({ signal }) => {
            calls += 1;
            setTimeout(() => controller.abort(), 10); // Stop pressed while the call is in flight
            return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("socket closed"))));
        };
        const events = [];
        const result = await runWorkflow({
            workflow: flow({ retry: fast }),
            signal: controller.signal,
            emit: (e) => events.push(e.type),
        });

        expect(calls).toBe(1); // a cancel is never retried
        expect(result.status).toBe("cancelled");
        expect(result.error).toBeNull();
        expect(statuses(result)).toEqual({ trigger: "success", call: "failed", out: "skipped" });
        expect(record(result, "call").error).toBe("Cancelled");
        expect(record(result, "out").skipReason).toBe("execution cancelled");
        expect(events.at(-1)).toBe("workflow.cancelled");
    });

    it("cancels during a backoff wait without waiting it out", async () => {
        const controller = new AbortController();
        nodeRegistry.httpRequest.execute = async () => {
            setTimeout(() => controller.abort(), 10);
            throw new NodeError("HTTP 503", { retryable: true });
        };
        const started = Date.now();
        const result = await runWorkflow({
            workflow: flow({ retry: { maxAttempts: 5, backoffMs: 10000 } }),
            signal: controller.signal,
        });

        expect(Date.now() - started).toBeLessThan(2000);
        expect(result.status).toBe("cancelled");
        expect(record(result, "call").attempts).toBe(1);
    });

    it("fails the execution when the workflow deadline passes", async () => {
        nodeRegistry.httpRequest.execute = () => new Promise(() => {});
        const result = await runWorkflow({
            workflow: flow({ retry: fast }),
            limits: { workflowTimeoutMs: 30, nodeTimeoutMs: 5000 },
        });

        expect(result.status).toBe("failed");
        expect(record(result, "call").attempts).toBe(1); // no time left, so no retry
        expect(record(result, "call").error).toBe("Workflow timed out after 30 ms");
        expect(record(result, "out").skipReason).toBe("workflow timed out");
    });
});
