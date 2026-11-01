// The run replayed on the sign-in page (components/auth/WorkflowPreview.jsx). It is not a real
// execution: a fixed timeline played back in the browser, so the page makes no API calls.
// demoStateAt() returns the same shape as lib/executionState.js ({ nodes: { id: { status, branch } } }),
// so the editor's own helpers (nodeStatuses, executedEdgeIds) colour the canvas.

const node = (id, type, x, y, label, config = {}) => ({ id, type, position: { x, y }, data: { label, config } });

export const DEMO_NODES = [
  node("trigger-1", "manualTrigger", 0, 40, "Start"),
  node("geo-1", "httpRequest", 250, 40, "Find the city", {
    method: "GET",
    url: "https://geocoding-api.open-meteo.com/v1/search",
  }),
  node("found-1", "condition", 500, 40, "City found?", {
    left: "{{nodes.geo-1.output.body.results}}",
    operator: "isNotEmpty",
  }),
  node("ai-1", "aiText", 750, -30, "Plan the day", { mode: "generate", input: "{{nodes.geo-1.output.body}}" }),
  node("notfound-1", "output", 750, 120, "Unknown city", { message: 'Could not find "{{input.city}}"' }),
];

export const DEMO_EDGES = [
  { id: "e1", source: "trigger-1", target: "geo-1", sourceHandle: null },
  { id: "e2", source: "geo-1", target: "found-1", sourceHandle: null },
  { id: "e3", source: "found-1", target: "ai-1", sourceHandle: "true" },
  { id: "e4", source: "found-1", target: "notfound-1", sourceHandle: "false" },
];

// Times in ms from the start of the loop. A step without a node only adds a log line.
const STEPS = [
  { at: 300, node: "trigger-1", status: "running" },
  { at: 600, node: "trigger-1", status: "success", log: "2 ms" },
  { at: 800, node: "geo-1", status: "running" },
  { at: 2000, node: "geo-1", status: "success", log: "GET 200 · 412 ms" },
  { at: 2200, node: "found-1", status: "running" },
  { at: 2500, node: "found-1", status: "success", branch: "true", log: "true branch · 1 ms" },
  { at: 2700, node: "notfound-1", status: "skipped", log: "Skipped: Condition 'found-1' took the true branch" },
  { at: 2900, node: "ai-1", status: "running" },
  { at: 4700, node: "ai-1", status: "success", log: "1.8 s" },
  { at: 4900, status: "completed", log: "Run completed · 4 nodes ran, 1 skipped · 4.6 s" },
];

export const DEMO_LENGTH_MS = 8000; // the finished state stays up for about 3 s, then it starts over

// State of the replay `ms` milliseconds into the loop.
// Returns { status, nodes, log } where log entries are { nodeId, status, text }.
export function demoStateAt(ms) {
  const nodes = Object.fromEntries(DEMO_NODES.map((n) => [n.id, { status: "idle" }]));
  const log = [];
  let status = "running";
  for (const step of STEPS) {
    if (step.at > ms) break;
    if (step.node) nodes[step.node] = { status: step.status, branch: step.branch };
    else status = step.status;
    if (step.log) log.push({ nodeId: step.node ?? null, status: step.status, text: step.log });
  }
  return { status, nodes, log };
}
