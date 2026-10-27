import mongoose from "mongoose";
import { Workflow } from "../models/Workflow.js";
import { AppError } from "../utils/AppError.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Workflow not found");

// Every lookup filters by owner. Someone else's workflow is reported as 404, not 403,
// so nobody can find out which ids exist.
async function findOwned(ownerId, id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const workflow = await Workflow.findOne({ _id: id, owner: ownerId });
    if (!workflow) throw notFound();
    return workflow;
}

export function createWorkflow(ownerId, data) {
    return Workflow.create({ ...data, owner: ownerId });
}

// The list only needs summaries, so the (large) nodes and edges are not loaded.
export function listWorkflows(ownerId) {
    return Workflow.find({ owner: ownerId })
        .select("name description createdAt updatedAt")
        .sort({ updatedAt: -1 });
}

export function getWorkflow(ownerId, id) {
    return findOwned(ownerId, id);
}

export async function updateWorkflow(ownerId, id, data) {
    const workflow = await findOwned(ownerId, id);
    workflow.set(data);
    return workflow.save();
}

export async function deleteWorkflow(ownerId, id) {
    const workflow = await findOwned(ownerId, id);
    await workflow.deleteOne();
}

export async function duplicateWorkflow(ownerId, id) {
    const original = await findOwned(ownerId, id);
    return Workflow.create({
        name: `${original.name} (copy)`.slice(0, 100),
        description: original.description,
        nodes: original.nodes,
        edges: original.edges,
        owner: ownerId,
    });
}
