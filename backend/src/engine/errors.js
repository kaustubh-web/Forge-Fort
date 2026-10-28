// A node failed for a reason we understand (bad data, unknown reference, wrong type).
// The message is shown to the user as-is, so it must be clear and contain no secrets.
// `retryable` is the hook for Phase 4: only transient errors (network, 429, 5xx, timeouts)
// set it to true. Everything in Phase 3 is deterministic, so retrying would not help.
export class NodeError extends Error {
    constructor(message, { retryable = false } = {}) {
        super(message);
        this.name = "NodeError";
        this.retryable = retryable;
    }
}
