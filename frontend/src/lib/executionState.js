// Pure functions that turn a persisted execution plus live SSE events into the state the editor
// shows (node colours, log panel, status badge). No React here, so it is unit tested directly.
//
// State shape:
//   { executionId, status, error, input, order: [nodeId], nodes: { [nodeId]: record },
//     outputs, logs, startedAt, endedAt, durationMs }
// A node record has the same fields as the backend's (status, input, output, attempts,
// attemptLog, error, skipReason, branch, startedAt, endedAt, durationMs).

export const FINISHED = new Set(["completed", "failed", "cancelled"]);

export const isFinished = (status) => FINISHED.has(status);

// Node statuses only ever move forward: idle -> running -> success / failed / skipped.
// The stream can deliver an event twice, and an old copy can arrive AFTER a snapshot that already
// contains the newer state (the server subscribes before it reads the snapshot, so nothing is
// lost, but it can repeat). Refusing to move backwards makes repeats harmless.
const NODE_RANK = { idle: 0, running: 1, success: 2, failed: 2, skipped: 2 };

function isNewer(next, current) {
  if (!current) return true;
  const a = NODE_RANK[next.status] ?? 0;
  const b = NODE_RANK[current.status] ?? 0;
  if (a !== b) return a > b;
  // Same status (for example "running" again on a retry): keep the one with more attempts.
  return (next.attempts ?? 0) >= (current.attempts ?? 0);
}

// From GET /api/executions/:id or the stream's "snapshot" event.
export function fromSnapshot(execution) {
  return {
    executionId: execution._id,
    status: execution.status,
    error: execution.error ?? null,
    input: execution.input ?? {},
    order: execution.nodes.map((record) => record.nodeId),
    nodes: Object.fromEntries(execution.nodes.map((record) => [record.nodeId, record])),
    outputs: execution.outputs ?? {},
    logs: execution.logs ?? [],
    startedAt: execution.startedAt ?? null,
    endedAt: execution.endedAt ?? null,
    durationMs: execution.durationMs ?? null,
  };
}

// One SSE event -> the next state. Returns the same object when nothing changes, so React can
// skip a re-render.
export function applyEvent(state, { type, data }) {
  if (type === "snapshot") return fromSnapshot(data);
  // Events only make sense on top of a snapshot of the same execution.
  if (!state || (data.executionId && data.executionId !== state.executionId)) return state;

  if (type.startsWith("node.")) {
    const record = data.record;
    if (!record || !isNewer(record, state.nodes[record.nodeId])) return state;
    const order = state.order.includes(record.nodeId) ? state.order : [...state.order, record.nodeId];
    return { ...state, order, nodes: { ...state.nodes, [record.nodeId]: record } };
  }

  if (type === "workflow.started") {
    return isFinished(state.status) ? state : { ...state, status: "running" };
  }

  if (FINISHED.has(data.status) && type.startsWith("workflow.")) {
    // The final event comes after outputs and logs were saved, but does not carry them. The
    // caller refetches GET /executions/:id when it sees this, to fill in outputs/logs/endedAt.
    return { ...state, status: data.status, error: data.error ?? null };
  }

  return state;
}

// nodeId -> status, for colouring the canvas. Nodes not in the execution are left out.
export function nodeStatuses(state) {
  if (!state) return {};
  return Object.fromEntries(Object.entries(state.nodes).map(([id, record]) => [id, record.status]));
}

// Ids of the edges the run actually travelled, for the animated "executed path".
// An edge counts when its source succeeded, a Condition source took that edge's handle,
// and its target was reached (running or finished, not skipped or never started).
export function executedEdgeIds(state, edges) {
  if (!state) return new Set();
  const reached = new Set(["running", "success", "failed"]);
  return new Set(
    edges
      .filter((edge) => {
        const source = state.nodes[edge.source];
        const target = state.nodes[edge.target];
        if (source?.status !== "success" || !reached.has(target?.status)) return false;
        return !source.branch || !edge.sourceHandle || edge.sourceHandle === source.branch;
      })
      .map((edge) => edge.id)
  );
}
