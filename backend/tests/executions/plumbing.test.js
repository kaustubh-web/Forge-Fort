import { describe, it, expect, vi } from "vitest";
import * as hub from "../../src/executions/executionHub.js";
import * as runningExecutions from "../../src/executions/runningExecutions.js";
import { redactDeep, REDACTED, TOO_DEEP } from "../../src/utils/redact.js";

describe("redactDeep", () => {
    it("replaces sensitive fields at any depth and leaves the original untouched", () => {
        const original = {
            name: "Ann",
            password: "x",
            nested: { headers: { Authorization: "Bearer t", accept: "*/*" }, list: [{ api_key: "k", id: 1 }] },
        };
        expect(redactDeep(original)).toEqual({
            name: "Ann",
            password: REDACTED,
            nested: { headers: { Authorization: REDACTED, accept: "*/*" }, list: [{ api_key: REDACTED, id: 1 }] },
        });
        expect(original.password).toBe("x");
    });

    it("keeps primitives, null and dates as they are", () => {
        const at = new Date();
        expect(redactDeep({ a: null, b: 1, c: "s", d: true, at })).toEqual({ a: null, b: 1, c: "s", d: true, at });
        expect(redactDeep("text")).toBe("text");
        expect(redactDeep([1, "two"])).toEqual([1, "two"]);
    });

    it("cuts off values nested deeper than MongoDB allows", () => {
        let deep = { leaf: true };
        for (let i = 0; i < 200; i++) deep = { child: deep };
        let level = redactDeep(deep);
        let depth = 0;
        while (level !== TOO_DEEP) {
            level = level.child;
            depth++;
        }
        expect(depth).toBe(40);
    });
});

describe("executionHub", () => {
    it("delivers events only to that execution's listeners until they unsubscribe", () => {
        const a = vi.fn();
        const b = vi.fn();
        const unsubscribeA = hub.subscribe("exec-a", a);
        hub.subscribe("exec-b", b);

        hub.publish("exec-a", { type: "node.started" });
        expect(a).toHaveBeenCalledWith({ type: "node.started" });
        expect(b).not.toHaveBeenCalled();

        unsubscribeA();
        hub.publish("exec-a", { type: "node.completed" });
        expect(a).toHaveBeenCalledTimes(1);
        expect(hub.listenerCount("exec-a")).toBe(0);
    });

    it("a throwing listener does not stop the others", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        const good = vi.fn();
        hub.subscribe("exec-c", () => {
            throw new Error("socket closed");
        });
        hub.subscribe("exec-c", good);
        expect(() => hub.publish("exec-c", { type: "x" })).not.toThrow();
        expect(good).toHaveBeenCalled();
        errorLog.mockRestore();
    });
});

describe("runningExecutions", () => {
    it("aborts the registered signal once, and forgets it after unregister", () => {
        const signal = runningExecutions.register("exec-1");
        expect(runningExecutions.isRunning("exec-1")).toBe(true);
        expect(runningExecutions.cancel("exec-1")).toBe(true);
        expect(signal.aborted).toBe(true);

        runningExecutions.unregister("exec-1");
        expect(runningExecutions.isRunning("exec-1")).toBe(false);
        expect(runningExecutions.cancel("exec-1")).toBe(false);
    });
});
