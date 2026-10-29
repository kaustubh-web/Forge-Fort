import { randomUUID } from "node:crypto";
import { nodeRegistry } from "../nodes/registry.js";
import { validateForRun } from "./validateForRun.js";
import { resolveConfig } from "./expressions.js";
import { NodeError, CancelledError, WorkflowTimeoutError } from "./errors.js";
import { backoffDelay, sleep, raceAbort } from "./retry.js";
import { debug } from "./debug.js";
import { env } from "../config/env.js";

// Nodes without a retry policy (in their config or their definition) run once.
const NO_RETRY = { maxAttempts: 1, backoffMs: 0 };

// The execution engine (docs/ARCHITECTURE.md sections 3-5).
//
//   validate -> topological order (Kahn) -> for each node, in order:
//     cancelled?             stop, mark the rest skipped, execution "cancelled"
//     no active input edge?  skip it (with a reason), its outgoing edges become inactive
//     otherwise              resolve {{expressions}}, run the handler, set outgoing edge states
//     handler failed?        transient error: wait (backoff) and retry, up to maxAttempts
//                            otherwise: node "failed", the rest skipped ("upstream failed"), execution "failed"
//
// Sequential and in-process on purpose: simple to follow and debug. Each node is visited
// exactly once (one pass over the topological order), so no node can ever run twice.
//
// `emit(event)` is called for every state change, with the SPEC event names. It is awaited, so
// the caller can persist the execution and push SSE events before the next node starts.
// Node events carry `record`, a copy of that node's record, so the caller can store it as-is.
// `signal` is the caller's AbortSignal (the Stop button). It reaches the HTTP and AI calls.
// `limits` defaults to the env values; tests pass small ones so they run fast.
export async function runWorkflow({
    workflow: rawWorkflow,
    input = {},
    executionId = randomUUID(),
    workflowId = null,
    signal,
    emit = () => {},
    limits = {},
}) {
    // Throws 400 INVALID_WORKFLOW before anything runs.
    const { workflow, graph, order } = validateForRun(rawWorkflow);
    debug("order:", order.join(" -> "));

    const nodeTimeoutMs = limits.nodeTimeoutMs ?? env.NODE_TIMEOUT_MS;
    const workflowTimeoutMs = limits.workflowTimeoutMs ?? env.WORKFLOW_TIMEOUT_MS;

    // One signal for the whole run that fires on Stop OR when the workflow deadline passes.
    // We keep both sources so we can tell afterwards WHY it fired: Stop means "cancelled",
    // the deadline means "failed".
    const deadline = AbortSignal.timeout(workflowTimeoutMs);
    const runSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const stopError = () => (deadline.aborted ? new WorkflowTimeoutError(workflowTimeoutMs) : new CancelledError());

    // Execution context. `nodes` is also the scope that {{nodes.<id>.output}} reads from.
    const context = {
        executionId,
        workflowId,
        input,
        status: "running",
        error: null,
        nodes: {}, // nodeId -> { status, output, error }
        logs: [], // lines written by Output nodes
        startedAt: new Date(),
        endedAt: null,
    };

    // One record per node, in run order. This is what gets stored and shown in the log panel.
    const records = new Map(order.map((id) => [id, newRecord(graph.nodeById.get(id))]));

    // Edge-state model: every edge starts "pending" and becomes "active" or "inactive" once its
    // source node has finished. A node runs only if at least one incoming edge is active.
    const edgeState = new Map(workflow.edges.map((edge) => [edge.id, "pending"]));

    const send = (type, payload = {}) =>
        emit({ type, executionId, timestamp: new Date().toISOString(), ...payload });

    function setOutgoing(nodeId, stateFor) {
        for (const edge of graph.outgoing.get(nodeId)) {
            edgeState.set(edge.id, stateFor(edge));
            debug(`  edge ${edge.id}: ${edgeState.get(edge.id)}`);
        }
    }

    async function skip(nodeId, reason) {
        const record = records.get(nodeId);
        record.status = "skipped";
        record.skipReason = reason;
        context.nodes[nodeId] = { status: "skipped", output: null, error: null };
        debug(`skip ${nodeId}: ${reason}`);
        setOutgoing(nodeId, () => "inactive");
        await send("node.skipped", { nodeId, status: "skipped", skipReason: reason, record: snapshot(record) });
    }

    async function skipAll(nodeIds, reason) {
        for (const id of nodeIds) await skip(id, reason);
    }

    // Why does this node have no active input? Look at the first incoming edge's source.
    function skipReasonFor(incoming) {
        const source = records.get(incoming[0].source);
        if (source.status === "success" && source.branch) {
            return `Condition '${source.nodeId}' took the ${source.branch} branch`;
        }
        if (source.status === "skipped") return `Upstream node '${source.nodeId}' was skipped`;
        return `Upstream node '${source.nodeId}' did not succeed`;
    }

    await send("workflow.started", { status: "running", order });

    for (let i = 0; i < order.length; i++) {
        const nodeId = order[i];
        const node = graph.nodeById.get(nodeId);
        const record = records.get(nodeId);

        // Stop / deadline is checked before every node. A node that is already running is
        // interrupted inside executeNode instead (its signal aborts the HTTP/AI call).
        if (runSignal.aborted) {
            const error = stopError();
            if (error instanceof CancelledError) {
                context.status = "cancelled";
                await skipAll(order.slice(i), "execution cancelled");
            } else {
                context.status = "failed";
                context.error = { nodeId: null, message: error.message };
                await skipAll(order.slice(i), "workflow timed out");
            }
            break;
        }

        const incoming = graph.incoming.get(nodeId);
        // Topological order guarantees every parent already finished, so no incoming edge can
        // still be pending. If one is, the engine itself is broken: fail loudly.
        if (incoming.some((edge) => edgeState.get(edge.id) === "pending")) {
            throw new Error(`Engine bug: "${nodeId}" reached with a pending incoming edge`);
        }

        // The converging-inputs rule: run if at least one incoming edge is active.
        // The trigger has no incoming edges and always runs.
        const active = incoming.filter((edge) => edgeState.get(edge.id) === "active");
        if (node.type !== "manualTrigger" && active.length === 0) {
            await skip(nodeId, skipReasonFor(incoming));
            continue;
        }

        // A node's input is the output of its first active parent (in edge order).
        // Any other earlier node can still be read with {{nodes.<id>.output...}}.
        record.input = node.type === "manualTrigger" ? input : context.nodes[active[0].source].output;
        record.status = "running";
        record.startedAt = new Date();
        debug(`run ${nodeId} (${node.type})`);
        await send("node.started", { nodeId, status: "running", record: snapshot(record) });

        let result;
        try {
            result = await executeNode(node, record, context, { runSignal, stopError, nodeTimeoutMs });
        } catch (error) {
            // NodeError / CancelledError = an expected, explainable stop. Anything else is a bug
            // in our code: still fail the node with its message (never swallow it), print the stack.
            const expected = error instanceof NodeError || error instanceof CancelledError;
            if (!expected) console.error(`[engine] unexpected error in ${nodeId}:`, error);
            const message = expected ? error.message : `Unexpected error: ${error.message}`;
            // Stop pressed mid-node: the node did not finish, so it is "failed" with "Cancelled",
            // but the execution as a whole is "cancelled" (the user's choice, not an error).
            const cancelled = error instanceof CancelledError;

            finish(record, "failed");
            record.error = message;
            context.nodes[nodeId] = { status: "failed", output: null, error: message };
            setOutgoing(nodeId, () => "inactive");
            context.status = cancelled ? "cancelled" : "failed";
            context.error = cancelled ? null : { nodeId, message };
            debug(`fail ${nodeId}: ${message}`);
            await send("node.failed", {
                nodeId,
                status: "failed",
                error: message,
                attempts: record.attempts,
                record: snapshot(record),
            });

            // Sequential engine: after a failure nothing else runs. Partial results are kept.
            let reason = "upstream failed";
            if (cancelled) reason = "execution cancelled";
            else if (error instanceof WorkflowTimeoutError) reason = "workflow timed out";
            await skipAll(order.slice(i + 1), reason);
            break;
        }

        finish(record, "success");
        record.output = result.output;
        record.branch = result.branch ?? null;
        context.nodes[nodeId] = { status: "success", output: result.output, error: null };

        // Normal node: every outgoing edge becomes active. A node that returns a branch
        // (Condition) activates only the edges leaving that handle; the others become inactive.
        setOutgoing(nodeId, (edge) =>
            result.branch === undefined || edge.sourceHandle === result.branch ? "active" : "inactive"
        );
        await send("node.completed", {
            nodeId,
            status: "success",
            branch: record.branch,
            durationMs: record.durationMs,
            record: snapshot(record),
        });
    }

    if (context.status === "running") context.status = "completed";
    context.endedAt = new Date();
    await send(`workflow.${context.status}`, { status: context.status, error: context.error });

    const nodes = [...records.values()];
    return {
        executionId,
        workflowId,
        status: context.status,
        input,
        nodes,
        // The final result: what each Output node produced (only those that ran).
        outputs: Object.fromEntries(
            nodes.filter((r) => r.type === "output" && r.status === "success").map((r) => [r.nodeId, r.output])
        ),
        logs: context.logs,
        error: context.error,
        startedAt: context.startedAt,
        endedAt: context.endedAt,
        durationMs: context.endedAt - context.startedAt,
    };
}

function newRecord(node) {
    return {
        nodeId: node.id,
        type: node.type,
        label: node.data.label,
        status: "idle",
        input: null,
        output: null,
        attempts: 0,
        attemptLog: [], // one entry per failed attempt: { attempt, error, waitMs }
        error: null,
        skipReason: null,
        branch: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
    };
}

// A copy for events: later changes to the live record (the next attempt, the final status) must
// not change an event that was already sent or stored. Shallow is enough: the engine replaces
// input/output/error instead of mutating them, and attemptLog is the only array it pushes to.
function snapshot(record) {
    return { ...record, attemptLog: [...record.attemptLog] };
}

function finish(record, status) {
    record.status = status;
    record.endedAt = new Date();
    record.durationMs = record.endedAt - record.startedAt;
}

// Run one node: its handler, with a timeout per attempt, retries for transient errors, and the
// run's abort signal. Throws NodeError (failed), CancelledError (Stop) or WorkflowTimeoutError.
async function executeNode(node, record, context, { runSignal, stopError, nodeTimeoutMs }) {
    const definition = nodeRegistry[node.type];

    // Expressions are resolved at run time, against the outputs that exist right now.
    // The stored config is never modified. Resolved once: every attempt sends the same request.
    const config = resolveConfig(node.data.config, { nodes: context.nodes, input: context.input });

    // Policy: the node's own config wins, then the type's default (HTTP/AI retry), then run once.
    const { maxAttempts, backoffMs } = config.retry ?? definition.defaultRetry ?? NO_RETRY;
    const timeoutMs = config.timeoutMs ?? nodeTimeoutMs;
    const log = (message) => context.logs.push({ nodeId: node.id, message, at: new Date() });

    for (let attempt = 1; ; attempt++) {
        record.attempts = attempt;
        try {
            return await runAttempt(definition, { config, input: record.input, log, node }, { runSignal, stopError, timeoutMs });
        } catch (error) {
            // Retry only errors the handler marked as transient. A Stop, a workflow timeout,
            // a bad config or a 404 would fail the same way again, so they end the node now.
            const retryable = error instanceof NodeError && error.retryable;
            if (!retryable || attempt >= maxAttempts) {
                record.attemptLog.push({ attempt, error: error.message, waitMs: null });
                throw error;
            }
            const waitMs = backoffDelay(attempt, backoffMs, error.retryAfterMs);
            record.attemptLog.push({ attempt, error: error.message, waitMs });
            debug(`  ${node.id} attempt ${attempt} failed (${error.message}), retrying in ${waitMs} ms`);
            try {
                await sleep(waitMs, runSignal); // Stop during the wait ends it at once
            } catch {
                throw stopError();
            }
        }
    }
}

// One attempt = one handler call with its own signal. That signal fires when:
//   - the user presses Stop or the workflow deadline passes (runSignal), or
//   - this attempt runs longer than timeoutMs.
// The handler passes it to fetch / the AI SDK, which closes the connection. raceAbort makes sure
// we stop waiting even if a handler ignores it.
async function runAttempt(definition, args, { runSignal, stopError, timeoutMs }) {
    const signal = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)]);
    let result;
    try {
        // Promise.resolve().then(...) turns a synchronous throw in a handler into a rejection.
        result = await raceAbort(Promise.resolve().then(() => definition.execute({ ...args, signal })), signal);
    } catch (error) {
        // Whatever the handler threw after an abort (AbortError, "fetch failed"...), replace it
        // with an error that says why it stopped. Only the per-node timeout is worth retrying.
        if (signal.aborted) {
            if (runSignal.aborted) throw stopError();
            throw new NodeError(`Timed out after ${timeoutMs} ms`, { retryable: true });
        }
        throw error;
    }
    if (!result || !("output" in result)) throw new Error(`Handler for ${args.node.type} returned no output`);
    return result;
}
