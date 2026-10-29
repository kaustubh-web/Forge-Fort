import { NodeError } from "../engine/errors.js";

// Turns any AI SDK error into a NodeError the engine understands. Both SDKs put the HTTP status
// on `error.status`. The message never contains the API key (SDKs send it as a header, not text).
export function toAiNodeError(providerName, error, signal) {
    if (signal?.aborted) return error; // Stop or timeout: the engine replaces it with the reason
    const status = error.status;
    const detail = String(error.message ?? "").slice(0, 300);

    if (status === 401 || status === 403) return new NodeError(`${providerName} rejected the API key (HTTP ${status})`);
    // Rate limited or provider trouble: may work a little later.
    if (status === 429 || status >= 500) return new NodeError(`${providerName} error (HTTP ${status}): ${detail}`, { retryable: true });
    // Any other HTTP status is our request's fault (unknown model, bad parameter): retrying will not help.
    if (status) return new NodeError(`${providerName} error (HTTP ${status}): ${detail}`);
    // No status = the request never got an answer (network error).
    return new NodeError(`${providerName} request failed: ${detail}`, { retryable: true });
}
