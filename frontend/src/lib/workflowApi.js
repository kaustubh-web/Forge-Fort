import { api } from "@/lib/api";

// Thin wrappers over the REST API (SPEC section 10). Each returns the unwrapped data.
// Errors are thrown by Axios; callers use getApiError(err) from lib/api.js.

export async function listWorkflows() {
  const res = await api.get("/workflows");
  return res.data.data.workflows;
}

export async function getWorkflow(id) {
  const res = await api.get(`/workflows/${id}`);
  return res.data.data.workflow;
}

export async function createWorkflow(workflow) {
  const res = await api.post("/workflows", workflow);
  return res.data.data.workflow;
}

export async function updateWorkflow(id, workflow) {
  const res = await api.put(`/workflows/${id}`, workflow);
  return res.data.data.workflow;
}

export async function deleteWorkflow(id) {
  await api.delete(`/workflows/${id}`);
}

export async function duplicateWorkflow(id) {
  const res = await api.post(`/workflows/${id}/duplicate`);
  return res.data.data.workflow;
}
