import { Play, Globe, Sparkles, GitBranch, Shuffle, FileText } from "lucide-react";

// One definition per node type. This is the single source of truth for:
//   - the palette (label, icon, description)
//   - the node card on the canvas (icon, summary)
//   - the config panel (fields)
//   - client-side validation (required fields)
// The backend has the matching Zod schemas in backend/src/nodes/registry.js.
// If you add a field here, add it there too, or the server strips it.
//
// Field kinds the config panel knows how to render:
//   text | textarea | number | select | list | keyValue | retry | operations

export const CONDITION_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "greaterThan",
  "lessThan",
  "isEmpty",
  "isNotEmpty",
];

// Transform operations. Predefined only, no user code (SPEC section 7).
// Parameters are provisional until the engine is built in Phase 3.
export const TRANSFORM_OPERATIONS = {
  select: { label: "Select fields", params: [{ name: "fields", kind: "list", label: "Fields to keep" }] },
  rename: {
    label: "Rename field",
    params: [
      { name: "from", kind: "text", label: "From" },
      { name: "to", kind: "text", label: "To" },
    ],
  },
  filter: {
    label: "Filter array",
    params: [
      { name: "path", kind: "text", label: "Array path" },
      { name: "field", kind: "text", label: "Item field" },
      { name: "operator", kind: "select", label: "Operator", options: CONDITION_OPERATORS },
      { name: "value", kind: "text", label: "Value" },
    ],
  },
  map: {
    label: "Map values",
    params: [
      { name: "path", kind: "text", label: "Array path" },
      { name: "field", kind: "text", label: "Set field" },
      { name: "value", kind: "text", label: "To value" },
    ],
  },
  merge: { label: "Merge object", params: [{ name: "source", kind: "text", label: "Object to merge in" }] },
  convert: {
    label: "Convert type",
    params: [
      { name: "field", kind: "text", label: "Field" },
      { name: "to", kind: "select", label: "To", options: ["string", "number", "boolean", "date"] },
    ],
  },
};

const clip = (text, max = 40) => (text && text.length > max ? `${text.slice(0, max)}...` : text);

export const nodeTypes = {
  manualTrigger: {
    label: "Manual Trigger",
    description: "Starts the workflow with optional JSON input.",
    icon: Play,
    defaultConfig: {},
    fields: [],
    summary: () => "Starts the workflow",
    missing: () => [],
  },

  httpRequest: {
    label: "HTTP Request",
    description: "Call an external API.",
    icon: Globe,
    defaultConfig: { method: "GET", url: "" },
    fields: [
      { name: "method", kind: "select", label: "Method", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { name: "url", kind: "text", label: "URL", placeholder: "https://api.example.com/items" },
      { name: "query", kind: "keyValue", label: "Query params" },
      { name: "headers", kind: "keyValue", label: "Headers" },
      { name: "body", kind: "textarea", label: "JSON body", placeholder: '{ "id": "{{nodes.trigger-1.output.id}}" }' },
      { name: "timeoutMs", kind: "number", label: "Timeout (ms)", placeholder: "30000" },
      { name: "retry", kind: "retry", label: "Retry" },
    ],
    summary: (c) => (c.url ? `${c.method || "GET"} ${clip(c.url)}` : "No URL set"),
    missing: (c) => (c.url?.trim() ? [] : ["URL"]),
  },

  aiText: {
    label: "AI Text",
    description: "Summarize, classify, extract JSON or generate text.",
    icon: Sparkles,
    defaultConfig: { mode: "summarize", input: "" },
    fields: [
      { name: "mode", kind: "select", label: "Mode", options: ["summarize", "classify", "extract", "generate"] },
      { name: "model", kind: "text", label: "Model (optional)" },
      { name: "instructions", kind: "textarea", label: "Instructions" },
      { name: "input", kind: "textarea", label: "Input", placeholder: "{{nodes.http-1.output.body}}" },
      { name: "categories", kind: "list", label: "Categories", showIf: (c) => c.mode === "classify" },
      { name: "jsonSchema", kind: "textarea", label: "JSON schema", showIf: (c) => c.mode === "extract" },
      { name: "timeoutMs", kind: "number", label: "Timeout (ms)", placeholder: "30000" },
      { name: "retry", kind: "retry", label: "Retry" },
    ],
    summary: (c) => (c.mode ? `${c.mode}: ${clip(c.input) || "no input"}` : "No mode set"),
    missing: (c) => {
      const missing = [];
      if (!c.mode) missing.push("Mode");
      if (!c.input?.trim()) missing.push("Input");
      if (c.mode === "classify" && !c.categories?.length) missing.push("Categories");
      if (c.mode === "extract" && !c.jsonSchema?.trim()) missing.push("JSON schema");
      return missing;
    },
  },

  condition: {
    label: "Condition",
    description: "Branch on a comparison: true or false.",
    icon: GitBranch,
    defaultConfig: { left: "", operator: "equals", right: "" },
    fields: [
      { name: "left", kind: "text", label: "Left value", placeholder: "{{nodes.http-1.output.status}}" },
      { name: "operator", kind: "select", label: "Operator", options: CONDITION_OPERATORS },
      {
        name: "right",
        kind: "text",
        label: "Right value",
        showIf: (c) => c.operator !== "isEmpty" && c.operator !== "isNotEmpty",
      },
    ],
    summary: (c) =>
      c.left && c.operator ? `${clip(c.left, 18)} ${c.operator} ${clip(c.right || "", 12)}`.trim() : "No condition set",
    missing: (c) => {
      const missing = [];
      if (!c.left?.trim()) missing.push("Left value");
      if (!c.operator) missing.push("Operator");
      const needsRight = c.operator !== "isEmpty" && c.operator !== "isNotEmpty";
      if (needsRight && !c.right?.trim()) missing.push("Right value");
      return missing;
    },
  },

  transform: {
    label: "Transform",
    description: "Reshape data with predefined operations.",
    icon: Shuffle,
    defaultConfig: { operations: [] },
    fields: [{ name: "operations", kind: "operations", label: "Operations" }],
    summary: (c) => {
      const n = c.operations?.length || 0;
      return n ? `${n} operation${n > 1 ? "s" : ""}` : "No operations";
    },
    missing: (c) => (c.operations?.length ? [] : ["At least one operation"]),
  },

  output: {
    label: "Output",
    description: "Write to the execution log and the final result.",
    icon: FileText,
    defaultConfig: { message: "" },
    fields: [
      { name: "message", kind: "textarea", label: "Message", placeholder: "Status: {{nodes.http-1.output.status}}" },
      { name: "data", kind: "keyValue", label: "Selected data" },
    ],
    summary: (c) => clip(c.message) || "Empty message",
    missing: (c) => (c.message?.trim() || c.data?.length ? [] : ["Message or data"]),
  },
};

export const NODE_TYPE_LIST = Object.keys(nodeTypes);

// Node ids are used inside expressions ({{nodes.<id>.output...}}), so they are readable and
// never contain a dot: "http-1", "condition-2", ...
export function nextNodeId(type, existingIds) {
  const taken = new Set(existingIds);
  let n = 1;
  while (taken.has(`${type}-${n}`)) n += 1;
  return `${type}-${n}`;
}

// The key used to carry "which node type is being dragged" from the palette to the canvas.
export const DRAG_TYPE = "application/x-forge-node-type";
