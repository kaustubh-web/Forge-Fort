import { createParser } from "eventsource-parser";
import { TOKEN_KEY, handleUnauthorized } from "@/lib/api";

// Reads GET /api/executions/:id/stream (Server-Sent Events) with fetch instead of EventSource,
// because EventSource cannot send the Authorization header (docs/decisions/sse-auth.md).
//
//   const close = openExecutionStream(id, { onEvent, onEnd, onError });
//
// onEvent({ type, data })  every event: first "snapshot" (the persisted execution), then live
//                          engine events (node.started, node.completed, ..., workflow.completed)
// onEnd()                  the run is over and the server closed the stream normally
// onError(error)           the stream failed or dropped mid-run. error.status is set for HTTP
//                          errors (404, 401...). The caller decides whether to reconnect; a new
//                          connection starts with a fresh snapshot, so nothing is lost.
// close()                  stop reading (unmount, new run). No callback fires after it.
//
// fetchImpl / baseUrl / getToken exist so tests can run without a browser or a server.

const FINAL_EVENTS = new Set(["workflow.completed", "workflow.failed", "workflow.cancelled"]);
// A node event carries the full node record, and an HTTP node's output can be up to 1 MB.
const MAX_EVENT_BYTES = 8 * 1024 * 1024;

export class StreamError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "StreamError";
    this.status = status;
  }
}

export function openExecutionStream(
  executionId,
  {
    onEvent,
    onEnd = () => {},
    onError = () => {},
    fetchImpl = (...args) => fetch(...args),
    baseUrl = import.meta.env.VITE_API_URL,
    getToken = () => localStorage.getItem(TOKEN_KEY),
  }
) {
  const controller = new AbortController();
  let closed = false;
  // Set once we know the run is over: a finished snapshot, or a final workflow.* event.
  let finished = false;

  // After close() the caller no longer wants anything, even if a chunk is still being parsed.
  const emit = (fn, ...args) => {
    if (!closed) fn(...args);
  };

  const parser = createParser({
    maxBufferSize: MAX_EVENT_BYTES,
    onEvent(message) {
      let data;
      try {
        data = JSON.parse(message.data);
      } catch {
        return emit(onError, new StreamError(`Bad event from server: ${message.event}`));
      }
      const type = message.event ?? "message";
      if (type === "snapshot" && data.status !== "running") finished = true;
      if (FINAL_EVENTS.has(type)) finished = true;
      emit(onEvent, { type, data });
    },
    onError(error) {
      emit(onError, new StreamError(`Could not read the stream: ${error.message}`));
    },
  });

  async function read() {
    const response = await fetchImpl(`${baseUrl}/executions/${executionId}/stream`, {
      headers: { Authorization: `Bearer ${getToken()}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) handleUnauthorized();
      // Errors before the stream starts are normal JSON envelopes: { success: false, error }.
      const body = await response.json().catch(() => null);
      throw new StreamError(body?.error?.message ?? `Stream failed (HTTP ${response.status})`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true keeps a multi-byte character that is split across two chunks intact.
      parser.feed(decoder.decode(value, { stream: true }));
    }

    // The server only closes the stream after the final event. Closing earlier means the
    // connection dropped (server restart, network), so report it and let the caller reconnect.
    if (!finished) throw new StreamError("The live stream was interrupted");
  }

  read()
    .then(() => emit(onEnd))
    .catch((error) => {
      if (closed) return; // our own abort, not a failure
      emit(onError, error instanceof StreamError ? error : new StreamError(error.message));
    });

  return function close() {
    closed = true;
    controller.abort();
  };
}
