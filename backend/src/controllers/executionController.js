
import * as executionService from "../services/executionService.js";
import { listExecutionsQuery } from "../schema/execution.js";
import { AppError } from "../utils/AppError.js";

export async function execute(req,res){
    const execution = await executionService.executeWorkflow(req.user._id, req.params.id, req.body.input);
    res.status(202).json({success: true, data : {executionId :execution._id, status: execution.status}});
}

// Express 5 makes req.query read-only, so the query string is parsed here instead of in the
// validate() middleware (which replaces req.body).
export async function list(req,res){
    const parsed = listExecutionsQuery.safeParse(req.query);
    if(!parsed.success){
        const details = parsed.error.issues.map((i)=>({ field: i.path.join("."), message: i.message }));
        throw new AppError(400,"VALIDATION_ERROR","Invalid query parameters", details);
    }
    const executions = await executionService.listExecutions(req.user._id, parsed.data);
    res.json({ success:true, data:{executions}});
}

export async function listForWorkflow(req,res){
    const executions = await executionService.listForWorkflow(req.user._id,req.params.id);
    res.json({ success:true, data:{executions}});
}

export async function get(req,res){
    const execution = await executionService.getExecution(req.user._id,req.params.id);
    res.json({ success: true, data:{execution}});
}

export async function cancel(req,res){
    const result = await executionService.cancelExecution(req.user._id,req.params.id);
    res.status(202).json({success:true,data: result});

}

