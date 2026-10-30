import { describe, it, expect, vi, afterEach } from "vitest";
import { openExecutionStream } from "@/lib/executionStream";

afterEach(() => vi.unstubAllGlobals());

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

// A fake fetch whose response body streams the given chunks (strings), optionally failing at the end.
function fakeFetch(chunks, { status = 200, json, failAtEnd } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (status !== 200) return new Response(JSON.stringify(json ?? {}), { status, headers: { "Content-Type": "application/json" } });
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        if (failAtEnd) controller.error(new TypeError("network error"));
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  return { fetchImpl, calls };
}

// Opens a stream and resolves when it ends or fails, with everything that was reported.
function run(fetchImpl) {
  return new Promise((resolve) => {
    const events = [];
    openExecutionStream("exec-1", {
      fetchImpl,
      baseUrl: "http://api.test/api",
      getToken: () => "tok",
      onEvent: (event) => events.push(event),
      onEnd: () => resolve({ events, ended: true }),
      onError: (error) => resolve({ events, error }),
    });
  });
}

describe("openExecutionStream", () => {
  it("sends the Bearer token and parses events, even when split across chunks", async () => {
    const text = sse("snapshot", { _id: "exec-1", status: "running", nodes: [] }) + sse("node.started", { nodeId: "a" }) + sse("workflow.completed", { status: "completed" });
    // Split in awkward places, including inside a multi-byte character ("é" is 2 bytes).
    const bytes = new TextEncoder().encode(text.replace('"a"', '"é"'));
    const { fetchImpl, calls } = fakeFetch([bytes.slice(0, 7), bytes.slice(7, 90), bytes.slice(90)]);

    const { events, ended } = await run(fetchImpl);

    expect(calls[0].url).toBe("http://api.test/api/executions/exec-1/stream");
    expect(calls[0].options.headers.Authorization).toBe("Bearer tok");
    expect(events.map((e) => e.type)).toEqual(["snapshot", "node.started", "workflow.completed"]);
    expect(events[1].data.nodeId).toBe("é");
    expect(ended).toBe(true);
  });

  it("ignores heartbeat comments", async () => {
    const { fetchImpl } = fakeFetch([": ping\n\n", sse("snapshot", { status: "completed", nodes: [] })]);
    const { events, ended } = await run(fetchImpl);
    expect(events.map((e) => e.type)).toEqual(["snapshot"]);
    expect(ended).toBe(true); // a finished snapshot followed by close is a normal end
  });

  it("reports a stream that closes before the run finished, so the caller can reconnect", async () => {
    const { fetchImpl } = fakeFetch([sse("snapshot", { status: "running", nodes: [] }), sse("node.started", { nodeId: "a" })]);
    const { events, error } = await run(fetchImpl);
    expect(events).toHaveLength(2);
    expect(error.message).toBe("The live stream was interrupted");
  });

  it("reports a network error in the middle of the stream", async () => {
    const { fetchImpl } = fakeFetch([sse("snapshot", { status: "running", nodes: [] })], { failAtEnd: true });
    const { error } = await run(fetchImpl);
    expect(error.name).toBe("StreamError");
    expect(error.message).toBe("network error");
  });

  it("turns an HTTP error into a StreamError with the server's message and status", async () => {
    const { fetchImpl } = fakeFetch([], { status: 404, json: { success: false, error: { code: "NOT_FOUND", message: "Execution not found" } } });
    const { error } = await run(fetchImpl);
    expect(error).toMatchObject({ status: 404, message: "Execution not found" });
  });

  it("logs out on 401, like the Axios client", async () => {
    const storage = new Map([["forge_token", "old"]]);
    const dispatched = [];
    vi.stubGlobal("localStorage", {
      getItem: (k) => storage.get(k) ?? null,
      removeItem: (k) => storage.delete(k),
    });
    vi.stubGlobal("window", { dispatchEvent: (e) => dispatched.push(e.type) });

    const { fetchImpl } = fakeFetch([], { status: 401, json: { success: false, error: { message: "Invalid or expired token" } } });
    const { error } = await run(fetchImpl);
    expect(error.status).toBe(401);
    expect(storage.has("forge_token")).toBe(false);
    expect(dispatched).toEqual(["auth:logout"]);
  });

  it("close() aborts the request and silences all callbacks", async () => {
    let signal;
    const fetchImpl = (url, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    };
    const onError = vi.fn();
    const onEnd = vi.fn();
    const close = openExecutionStream("exec-1", { fetchImpl, baseUrl: "", getToken: () => "t", onEvent: () => {}, onEnd, onError });
    close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
