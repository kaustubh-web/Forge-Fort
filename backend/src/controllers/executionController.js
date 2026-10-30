
import * as executionService from "../services/executionService.js";

export async function execute(req,res){
    const execution = await executionService.executeWorkflow(req.user._id, req.params.id, req.body.input);
    res.status(202).json({success: true, data : {executionId :execution._id, status: execution.status}});
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

