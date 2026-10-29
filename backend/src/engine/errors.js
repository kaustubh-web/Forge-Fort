// A node failed for a reason we understand (bad data, unknown reference, wrong type).
// The message is shown to the user as-is, so it must be clear and contain no secrets.
//
// `retryable` is true only for transient errors (network errors, timeouts, HTTP 429/502/503/504,
// AI rate limits): trying again might work. Everything else fails at once, because retrying a
// bad URL or a 404 would give the same result and only waste time.
// `retryAfterMs` is the server's own "try again in N ms" hint (HTTP Retry-After), if it sent one.
export class NodeError extends Error {
    constructor(message, { retryable = false, retryAfterMs = null } = {}) {
        super(message);
        this.name = "NodeError";
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
    }
}

// The user pressed Stop. Never retried. The engine marks the execution "cancelled", not "failed".
export class CancelledError extends Error {
    constructor() {
        super("Cancelled");
        this.name = "CancelledError";
    }
}

// The whole workflow ran past WORKFLOW_TIMEOUT_MS. A NodeError (so the node fails normally),
// but never retryable: there is no time left to retry in.
export class WorkflowTimeoutError extends NodeError {
    constructor(timeoutMs) {
        super(`Workflow timed out after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`}`);
        this.name = "WorkflowTimeoutError";
    }
}
