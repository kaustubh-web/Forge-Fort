// Small helpers for retries and cancellation, used by executeNode in runWorkflow.js.

// No single wait is longer than this, whatever the policy or a Retry-After header asks for.
export const MAX_BACKOFF_MS = 30000;

// Exponential backoff: wait backoffMs, then 2x, then 4x... after attempts 1, 2, 3...
// Spacing retries out gives an overloaded server time to recover instead of hammering it.
// If the server said how long to wait (Retry-After), wait at least that long.
export function backoffDelay(attempt, backoffMs, retryAfterMs = null) {
    const exponential = backoffMs * 2 ** (attempt - 1);
    return Math.min(Math.max(exponential, retryAfterMs ?? 0), MAX_BACKOFF_MS);
}

// setTimeout as a promise that ends early (rejects with signal.reason) if the signal aborts,
// so pressing Stop during a backoff wait takes effect immediately.
export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

// Settle with `promise`, or reject as soon as `signal` aborts, whichever comes first.
// Handlers pass the signal on to fetch / the AI SDK, which really stops the work. This race is
// the safety net: even a handler that ignores its signal can never hang the engine.
export function raceAbort(promise, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        // If the abort wins, a later result or error from `promise` lands here and is ignored
        // (a settled promise cannot settle twice), so it never becomes an unhandled rejection.
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}
