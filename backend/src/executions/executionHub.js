// In-memory pub/sub between the runner (publishes engine events) and SSE streams (subscribe).
//
// executionId -> Set of listener functions. Each open stream for that execution adds one listener
// and removes it when the client disconnects. Nothing is buffered: a stream that connects later
// starts from the persisted execution (the snapshot), so it does not need old events.
const listeners = new Map();

export function subscribe(executionId, listener) {
    const id = String(executionId);
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(listener);

    return function unsubscribe() {
        const set = listeners.get(id);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) listeners.delete(id); // no empty sets left behind after the run
    };
}

// A listener that throws (for example a socket that just closed) must not break the run or the
// other viewers, so each call is isolated. Listeners are copied first because one may unsubscribe
// while we loop.
export function publish(executionId, event) {
    for (const listener of [...(listeners.get(String(executionId)) ?? [])]) {
        try {
            listener(event);
        } catch (error) {
            console.error(`[hub] listener for ${executionId} failed:`, error.message);
        }
    }
}

export function listenerCount(executionId) {
    return listeners.get(String(executionId))?.size ?? 0;
}
