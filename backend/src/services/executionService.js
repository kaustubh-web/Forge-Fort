import mongoose from "mongoose";
import { WorkflowExecution } from "../models/WorkflowExecution.js";
import { getWorkflow } from "./workflowService.js";
import { validateForRun } from "../engine/validateForRun.js";
import { startExecution } from "../executions/executionRunner.js";
import * as runningExecutions from "../executions/runningExecutions.js";
import { redactDeep } from "../utils/redact.js";
import { AppError } from "../utils/AppError.js";

const notFound = () => new AppError(404,"NOT_FOUND","Execution not found");


async function findOwned(ownerId, id){
    if(!mongoose.isValidObjectId(id)) throw notFound();
    const execution = await WorkflowExecution.findOne({_id: id, owner: ownerId});
    if(!execution) throw notFound();
    return execution;
}

// POST /api/workflows/:id/execute
// Validate everything first, so a bad graph returns 400 and leaves no execution behind.
// Then create the record, start the engine WITHOUT awaiting it, and return at once (202).

export async function executeWorkflow(ownerId, workflowId, input){
    const workflow = await getWorkflow(ownerId, workflowId);
    const plain = workflow.toObject();
    const {order, graph} = validateForRun(plain);

    const execution = await WorkflowExecution.create({
        workflow: workflow._id,
        owner: ownerId,
        input: redactDeep(input),

        nodes: order.map((nodeId)=>{
            const node = graph.nodeById.get(nodeId);
            return {nodeId, type: node.type, label: node.data.label};
        }),
        metadata: {workflowName: workflow.name},
    });

    startExecution ({execution,workflow: plain, input});
    return execution;
}

export function getExecution(ownerId, id){
    return findOwned(ownerId,id);
}

// GET /api/workflows/:id/executions: summaries for the history list, newest first.
// input is included so the UI can "rerun with the same input".

export async function listForWorkflow(ownerId, workflowId){
    const workflow = await getWorkflow(ownerId,workflowId);
    return WorkflowExecution.find({workflow: workflow._id, owner: ownerId})
          .select("status input error startedAt endedAt durationMs metadata")
          .sort({ startedAt: -1 })
          .limit(50);

}

// POST /api/executions/:id/cancel
// Only asks the engine to stop. The engine finishes the run itself (node "failed: Cancelled",
// rest skipped, status "cancelled"), and the stream reports it, so we return 202, not the result.

export async function cancelExecution(ownerId,id){
    const execution = await findOwned(ownerId,id);
    if(execution.status !== "running"){
        throw new AppError(409, "NOT_RUNNING",`Execution is already ${execution.status}`);
    }

    if(!runningExecutions.cancel(id)){
        execution.status = "cancelled";
        execution.endedAt = new Date();
        await execution.save();
    }
    return {executionId: String(execution._id), status:"cancelling"};
}

export async function markInterruptedExecutions(){
    const message = "server restarted";
    const result = await WorkflowExecution.updateMany(
        { status: "running"},
        {
            $set:{
                status: "failed",
                error: {nodeId: null,message},
                endedAt: new Date(),
                "nodes.$[run].status":"failed",
                "nodes.$[run].error":message,
                "nodes.$[idle].status":"skipped",
                "nodes.$[idle].skipReason":message,

            },
        },
        {arrayFilters: [{"run.status":"running"},{"idle.status":"idle"}]}
    );
    return result.modifiedCount;
}