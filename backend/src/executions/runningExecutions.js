// The AbortController of every execution running in THIS process, by execution id.
//
// POST /api/executions/:id/cancel cannot reach into a running promise, so the runner registers
// a controller here when it starts and the cancel route calls abort() on it. The engine passes
// that signal to every HTTP/AI call and checks it before each node (docs/ARCHITECTURE.md section 7).
//
// Single-instance limitation: the map lives in memory. With two API servers, a cancel request
// could land on the server that is not running the execution.
const controllers = new Map();

// Returns the signal the runner hands to the engine.
export function register(executionId) {
    const controller = new AbortController();
    controllers.set(String(executionId), controller);
    return controller.signal;
}

// true if the execution was running here and is now being cancelled.
export function cancel(executionId) {
    const controller = controllers.get(String(executionId));
    if (!controller) return false;
    controller.abort();
    return true;
}

export function isRunning(executionId) {
    return controllers.has(String(executionId));
}

export function unregister(executionId) {
    controllers.delete(String(executionId));
}
