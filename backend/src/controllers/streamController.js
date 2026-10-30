import * as executionService from "../services/executionService.js";
import * as hub from "../executions/executionHub.js";

// GET /api/executions/:id/stream  (Server-Sent Events, docs/decisions/sse-auth.md)
//
// What the client receives:
//   event: snapshot            the persisted execution, always first
//   event: node.started ...    live engine events, in order (see SPEC section 8)
//   event: workflow.completed  (or .failed / .cancelled), then the server closes the stream
// A finished execution gets only the snapshot, then the stream closes.
//
// Because every connection starts with a fresh snapshot from MongoDB, reconnecting after a drop
// is just "open the stream again": no event ids, no replay buffer on the server.
//
// Auth is the normal Bearer header (requireAuth on the router). The browser reads this with
// fetch(), not EventSource, because EventSource cannot send headers.

const HEARTBEAT_MS = 15_000;
const FINAL_EVENTS = new Set(["workflow.completed", "workflow.failed", "workflow.cancelled"]);
const FINISHED = new Set(["completed", "failed", "cancelled"]);

export async function streamExecution(req, res) {
    const executionId = req.params.id;

    // 1. Subscribe FIRST and hold events in a buffer, 2. then read the snapshot.
    // The other order loses events: anything the runner saved and published after our read
    // but before we subscribed would be in neither the snapshot nor the stream. This way every
    // event is either already in the snapshot or arrives in the buffer. Some may be in both;
    // that is harmless, because applying the same node record twice gives the same state.
    // (Subscribing before the ownership check is safe: nothing is sent until it passes.)
    let buffer = [];
    let deliver = (event) => buffer.push(event);
    const unsubscribe = hub.subscribe(executionId, (event) => deliver(event));

    let execution;
    try {
        execution = await executionService.getExecution(req.user._id, executionId); // 404 if not yours
    } catch (error) {
        unsubscribe();
        throw error; // headers not sent yet, so the error handler still answers with JSON
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform", // proxies must not cache or compress (buffer) it
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // tells nginx-style proxies to pass each event through at once
    });

    // A comment line (starts with ":") keeps idle connections from being closed by proxies.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
    }
    // The browser went away (tab closed, Stop reading, network drop): stop listening.
    res.on("close", close);

    function write(type, data) {
        if (closed) return;
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        if (FINAL_EVENTS.has(type)) close();
    }

    write("snapshot", execution.toJSON());
    if (FINISHED.has(execution.status)) return close();

    // From now on events go straight out; first flush what arrived while we read the snapshot.
    deliver = (event) => write(event.type, event);
    const pending = buffer;
    buffer = null;
    for (const event of pending) write(event.type, event);
}
