import { api } from "@/lib/api";

// Thin wrappers over the execution routes (SPEC section 10). Each returns the unwrapped data.
// Errors are thrown by Axios; callers use getApiError(err) from lib/api.js.
// The live stream is not here: it needs fetch, see lib/executionStream.js.

// 202: the run has started. Returns { executionId, status: "running" }.
export async function executeWorkflow(workflowId, input = {}) {
  const res = await api.post(`/workflows/${workflowId}/execute`, { input });
  return res.data.data;
}

// The full persisted execution: status, error, and one record per node in run order.
export async function getExecution(executionId) {
  const res = await api.get(`/executions/${executionId}`);
  return res.data.data.execution;
}

// Newest runs across all of the user's workflows (the Executions page). Optional filter:
// status = "running" | "completed" | "failed" | "cancelled". Summaries carry metadata.workflowName.
export async function listAllExecutions(status) {
  const res = await api.get("/executions", { params: status ? { status } : {} });
  return res.data.data.executions;
}

// History of one workflow, newest first (summaries without node records).
export async function listExecutions(workflowId) {
  const res = await api.get(`/workflows/${workflowId}/executions`);
  return res.data.data.executions;
}

// 202: the engine was asked to stop; the stream reports when it has. 409 if not running.
export async function cancelExecution(executionId) {
  const res = await api.post(`/executions/${executionId}/cancel`);
  return res.data.data;
}
