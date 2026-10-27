// Converts between the API's workflow JSON (SPEC section 3) and React Flow's node/edge objects.
//
// React Flow adds UI-only fields to nodes while you work (selected, dragging, measured, width,
// height, ...). Those must never be saved, so toWorkflowJson() copies only the known fields.

export function toFlowNodes(workflowNodes = []) {
  return workflowNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { label: n.data?.label ?? "", config: n.data?.config ?? {} },
  }));
}

export function toFlowEdges(workflowEdges = []) {
  return workflowEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
  }));
}

export function toWorkflowJson({ name, description = "", nodes, edges }) {
  return {
    name,
    description,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: { label: n.data.label ?? "", config: n.data.config ?? {} },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    })),
  };
}
