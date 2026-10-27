import { nodeTypes } from "@/lib/nodeTypes";

// Client-side checks before a run (SPEC section 11). The server validates again when it runs:
// this only gives the user fast feedback. Returns a list of { nodeId, message }.
// An empty list means the graph is ready to run.

export function validateGraph(nodes, edges) {
  const issues = [];
  const add = (nodeId, message) => issues.push({ nodeId, message });
  const nameOf = (node) => node.data?.label || nodeTypes[node.type]?.label || node.id;

  // 1. Exactly one trigger
  const triggers = nodes.filter((n) => n.type === "manualTrigger");
  if (triggers.length === 0) add(null, "Add a Manual Trigger to start the workflow");
  if (triggers.length > 1) add(null, "A workflow can have only one Manual Trigger");

  // 2. Cycles (Kahn): if some nodes are never reached, they sit on or behind a cycle
  const cyclic = findCycleNodes(nodes, edges);
  for (const node of cyclic) add(node.id, `${nameOf(node)} is part of a cycle`);

  // 3. Everything must be reachable from the trigger (BFS). This also catches disconnected nodes.
  if (triggers.length === 1) {
    const reachable = reachableFrom(triggers[0].id, edges);
    for (const node of nodes) {
      if (!reachable.has(node.id)) add(node.id, `${nameOf(node)} is not connected to the trigger`);
    }
  }

  // 4. Required configuration
  for (const node of nodes) {
    const def = nodeTypes[node.type];
    if (!def) continue;
    const missing = def.missing(node.data?.config || {});
    if (missing.length) add(node.id, `${nameOf(node)}: missing ${missing.join(", ")}`);
  }

  return issues;
}

// Kahn's algorithm (same idea as the backend engine in Phase 3):
// repeatedly remove nodes with no unprocessed incoming edges. Whatever is left is cyclic.
function findCycleNodes(nodes, edges) {
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const children = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
    inDegree.set(e.target, inDegree.get(e.target) + 1);
    children.get(e.source).push(e.target);
  }

  const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  const done = new Set();
  while (queue.length) {
    const id = queue.shift();
    done.add(id);
    for (const child of children.get(id)) {
      inDegree.set(child, inDegree.get(child) - 1);
      if (inDegree.get(child) === 0) queue.push(child);
    }
  }
  return nodes.filter((n) => !done.has(n.id));
}

// BFS from the trigger along edges.
function reachableFrom(startId, edges) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const e of edges) {
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return seen;
}
