import { runWorkflow } from "../engine/runWorkflow.js";
import { WorkflowExecution } from "../models/WorkflowExecution.js";
import { redactDeep, createValueRedactor } from "../utils/redact.js";
import * as runningExecutions from "./runningExecutions.js";
import * as hub from "./executionHub.js";

// Runs an execution in the background and keeps MongoDB and the SSE streams in step with it.
//
//   service creates the execution record (status "running", one idle record per node)
//     -> startExecution(): register a cancel controller, start the engine, do NOT wait for it
//        engine emit(event) for each state change:
//          1. redact the event (secrets never reach the DB or the browser)
//          2. persist: $set that node's record                  <- after EVERY node change
//          3. publish to the hub -> every open SSE stream for this execution
//     -> engine returns: save the final status, outputs, logs, then publish the final event
//     -> finally: remove the cancel controller
//
// Persist BEFORE publish: whatever a viewer has seen live is already in the database, so a page
// refresh (which reloads from the DB) can never show less than the stream did.
//
// `execution` is the saved WorkflowExecution, `workflow` a plain workflow object (the service
// passes workflow.toObject()). `input` is the REAL run input: the stored execution.input is
// redacted, but a node may need the secret (for example {{input.apiKey}} in a header).
// `secrets` holds the decrypted {{secrets.NAME}} values this workflow uses (memory only).
// Returns a promise that never rejects: the API does not await it, tests do.
export function startExecution({ execution, workflow, input, secrets = {}, limits }) {
    const executionId = String(execution._id);
    const signal = runningExecutions.register(executionId);
    return run({ execution, workflow, input, secrets, limits, executionId, signal }).finally(() =>
        runningExecutions.unregister(executionId)
    );
}

async function run({ execution, workflow, input, secrets, limits, executionId, signal }) {
    // Two layers before anything is stored or streamed: key names that look like credentials
    // (redactDeep), then this run's actual secret values wherever they appear (an API echoing
    // the token back, an error message quoting the URL).
    const hideSecrets = createValueRedactor(Object.values(secrets));
    const redact = (value) => hideSecrets(redactDeep(value));

    // The service stored one record per node in topological order. The engine sends node ids,
    // MongoDB updates array items by position, so map one to the other.
    const indexOf = new Map(execution.nodes.map((record, i) => [record.nodeId, i]));
    let finalEvent = null;

    async function emit(event) {
        const safe = redact(event);

        // The final workflow.* event is held back until outputs and logs are saved (below), so
        // a client that refetches when it sees "completed" gets the complete record.
        if (isFinal(safe.type)) {
            finalEvent = safe;
            return;
        }
        if (safe.record) {
            const index = indexOf.get(safe.nodeId);
            if (index === undefined) throw new Error(`Runner bug: no stored record for node "${safe.nodeId}"`);
            await WorkflowExecution.updateOne({ _id: executionId }, { $set: { [`nodes.${index}`]: safe.record } });
        }
        hub.publish(executionId, safe);
    }

    try {
        const result = await runWorkflow({
            workflow,
            input,
            secrets,
            executionId,
            workflowId: String(execution.workflow),
            signal,
            emit,
            limits,
        });
        await WorkflowExecution.updateOne(
            { _id: executionId },
            {
                $set: {
                    status: result.status,
                    error: redact(result.error),
                    outputs: redact(result.outputs),
                    logs: redact(result.logs),
                    endedAt: result.endedAt,
                    durationMs: result.durationMs,
                },
            }
        );
        if (finalEvent) hub.publish(executionId, finalEvent);
    } catch (error) {
        // Not a node failure (the engine turns those into a "failed" result): this is a bug, a
        // database error while persisting, or a graph that no longer validates. Never swallow
        // it: log the stack, store it on the execution, and tell the viewers.
        console.error(`[runner] execution ${executionId} crashed:`, hideSecrets(error.stack ?? String(error)));
        await failExecution(executionId, execution.startedAt, { message: hideSecrets(error.message) });
    }
}

async function failExecution(executionId, startedAt, error) {
    const endedAt = new Date();
    const message = `Execution error: ${error.message}`;
    try {
        // Nodes the crash interrupted would otherwise stay "running" / "idle" forever.
        // arrayFilters update every matching item of the nodes array in one write.
        await WorkflowExecution.updateOne(
            { _id: executionId },
            {
                $set: {
                    status: "failed",
                    error: { nodeId: null, message },
                    endedAt,
                    durationMs: startedAt ? endedAt - new Date(startedAt) : null,
                    "nodes.$[run].status": "failed",
                    "nodes.$[run].error": message,
                    "nodes.$[idle].status": "skipped",
                    "nodes.$[idle].skipReason": "execution error",
                },
            },
            { arrayFilters: [{ "run.status": "running" }, { "idle.status": "idle" }] }
        );
    } catch (dbError) {
        // The database itself is the problem. Boot recovery will mark it failed on the next start.
        console.error(`[runner] could not store the failure of ${executionId}:`, dbError.message);
    }
    hub.publish(executionId, {
        type: "workflow.failed",
        executionId,
        timestamp: endedAt.toISOString(),
        status: "failed",
        error: { nodeId: null, message },
    });
}

const isFinal = (type) => type === "workflow.completed" || type === "workflow.failed" || type === "workflow.cancelled";
