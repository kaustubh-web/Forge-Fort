import { randomUUID } from "node:crypto";
import { nodeRegistry } from "../nodes/registry.js";
import { validateForRun } from "./validateForRun.js";
import { resolveConfig } from "./expressions.js";
import { NodeError } from "./errors.js";
import { debug } from "./debug.js";

// The execution engine (docs/ARCHITECTURE.md sections 3-5).
//
//   validate -> topological order (Kahn) -> for each node, in order:
//     cancelled?             stop, mark the rest skipped, execution "cancelled"
//     no active input edge?  skip it (with a reason), its outgoing edges become inactive
//     otherwise              resolve {{expressions}}, run the handler, set outgoing edge states
//     handler failed?        node "failed", the rest skipped ("upstream failed"), execution "failed"
//
// Sequential and in-process on purpose: simple to follow and debug. Each node is visited
// exactly once (one pass over the topological order), so no node can ever run twice.
//
// `emit(event)` is called for every state change, with the SPEC event names. It is awaited, so
// Phase 5 can persist the execution and push SSE events from it before the next node starts.
// `signal` is an AbortSignal; Phase 4 also passes it into HTTP and AI calls.
export async function runWorkflow({
    workflow: rawWorkflow,
    input = {},
    executionId = randomUUID(),
    workflowId = null,
    signal,
    emit = () => {},
}) {
    // Throws 400 INVALID_WORKFLOW before anything runs.
    const { workflow, graph, order } = validateForRun(rawWorkflow);
    debug("order:", order.join(" -> "));

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
        await send("node.skipped", { nodeId, status: "skipped", skipReason: reason });
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

        // Cancellation is checked before every node. The node that is already running is not
        // interrupted here; in Phase 4 the same signal aborts its HTTP/AI call.
        if (signal?.aborted) {
            context.status = "cancelled";
            await skipAll(order.slice(i), "execution cancelled");
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
        await send("node.started", { nodeId, status: "running" });

        let result;
        try {
            result = await executeNode(node, record, context, signal);
        } catch (error) {
            // NodeError = an expected, explainable failure. Anything else is a bug in our code:
            // still fail the node with its message (never swallow it), and print the stack.
            if (!(error instanceof NodeError)) console.error(`[engine] unexpected error in ${nodeId}:`, error);
            const message = error instanceof NodeError ? error.message : `Unexpected error: ${error.message}`;

            finish(record, "failed");
            record.error = message;
            context.nodes[nodeId] = { status: "failed", output: null, error: message };
            setOutgoing(nodeId, () => "inactive");
            context.status = "failed";
            context.error = { nodeId, message };
            debug(`fail ${nodeId}: ${message}`);
            await send("node.failed", { nodeId, status: "failed", error: message });

            // Sequential engine: after a failure nothing else runs. Partial results are kept.
            await skipAll(order.slice(i + 1), "upstream failed");
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
        error: null,
        skipReason: null,
        branch: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
    };
}

function finish(record, status) {
    record.status = status;
    record.endedAt = new Date();
    record.durationMs = record.endedAt - record.startedAt;
}

// Run one node's handler. This is the seam for Phase 4: per-node timeout, the AbortSignal
// passed into HTTP/AI calls, and retries of errors with `retryable: true` all wrap this call.
async function executeNode(node, record, context, signal) {
    const definition = nodeRegistry[node.type];

    // Expressions are resolved at run time, against the outputs that exist right now.
    // The stored config is never modified.
    const config = resolveConfig(node.data.config, { nodes: context.nodes, input: context.input });

    record.attempts += 1;
    const log = (message) => context.logs.push({ nodeId: node.id, message, at: new Date() });
    const result = await definition.execute({ config, input: record.input, signal, log, node });

    if (!result || !("output" in result)) throw new Error(`Handler for ${node.type} returned no output`);
    return result;
}
