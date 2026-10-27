import * as workflowService from "../services/workflowService.js";

export async function create(req, res) {
    const workflow = await workflowService.createWorkflow(req.user._id, req.body);
    res.status(201).json({ success: true, data: { workflow } });
}

export async function list(req, res) {
    const workflows = await workflowService.listWorkflows(req.user._id);
    res.json({ success: true, data: { workflows } });
}

export async function get(req, res) {
    const workflow = await workflowService.getWorkflow(req.user._id, req.params.id);
    res.json({ success: true, data: { workflow } });
}

export async function update(req, res) {
    const workflow = await workflowService.updateWorkflow(req.user._id, req.params.id, req.body);
    res.json({ success: true, data: { workflow } });
}

export async function remove(req, res) {
    await workflowService.deleteWorkflow(req.user._id, req.params.id);
    res.json({ success: true, data: { id: req.params.id } });
}

export async function duplicate(req, res) {
    const workflow = await workflowService.duplicateWorkflow(req.user._id, req.params.id);
    res.status(201).json({ success: true, data: { workflow } });
}
