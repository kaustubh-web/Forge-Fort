import mongoose from "mongoose";

const { Mixed } = mongoose.Schema.Types;

export const EXECUTION_STATUSES = ["running", "completed", "failed", "cancelled"];
export const NODE_STATUSES = ["idle", "running", "success", "failed", "skipped"];

// One entry per node, in run (topological) order. Same shape as the engine's record
// (newRecord in engine/runWorkflow.js), so the runner can store an event's record as-is.
// input/output are Mixed: they are whatever JSON the node received or produced.
const nodeRecordSchema = new mongoose.Schema(
    {
        nodeId: { type: String, required: true },
        type: { type: String, required: true },
        label: { type: String, default: "" },
        status: { type: String, enum: NODE_STATUSES, default: "idle" },
        input: { type: Mixed, default: null },
        output: { type: Mixed, default: null },
        attempts: { type: Number, default: 0 },
        attemptLog: { type: [Mixed], default: [] }, // { attempt, error, waitMs } per failed attempt
        error: { type: String, default: null },
        skipReason: { type: String, default: null },
        branch: { type: String, default: null }, // "true" / "false" for Condition nodes
        startedAt: { type: Date, default: null },
        endedAt: { type: Date, default: null },
        durationMs: { type: Number, default: null },
    },
    // Node records live inside the execution and are found by nodeId, so no _id of their own.
    { _id: false }
);

const workflowExecutionSchema = new mongoose.Schema(
    {
        workflow: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", required: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        status: { type: String, enum: EXECUTION_STATUSES, default: "running" },
        input: { type: Mixed, default: {} },
        nodes: { type: [nodeRecordSchema], default: [] },
        error: { type: Mixed, default: null }, // { nodeId, message } when the run failed
        logs: { type: [Mixed], default: [] }, // lines written by Output nodes
        outputs: { type: Mixed, default: {} }, // the final result: Output node id -> its output
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date, default: null },
        durationMs: { type: Number, default: null },
        // The workflow can be renamed or deleted later; history should still show what ran.
        metadata: {
            workflowName: { type: String, default: "" },
        },
    },
    {
        // Same reason as Workflow: keep empty objects such as `input: {}` when saving.
        minimize: false,
        toJSON: {
            transform: (doc, ret) => {
                delete ret.__v;
                return ret;
            },
        },
    }
);

// History of one workflow, newest first: GET /api/workflows/:id/executions.
workflowExecutionSchema.index({ workflow: 1, startedAt: -1 });
// Boot recovery looks up every execution still "running".
workflowExecutionSchema.index({ status: 1 });
// Executions page: a user's newest runs across all workflows (GET /api/executions).
workflowExecutionSchema.index({ owner: 1, startedAt: -1 });

export const WorkflowExecution = mongoose.model("WorkflowExecution", workflowExecutionSchema);
