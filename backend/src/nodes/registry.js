import { manualTrigger } from "./manualTrigger.js";
import { httpRequest } from "./httpRequest.js";
import { aiText } from "./aiText.js";
import { condition } from "./condition.js";
import { transform } from "./transform.js";
import { output } from "./output.js";

// Node registry (SPEC section 6): node type -> definition.
// Each definition lives in its own file and has:
//   configSchema    Zod schema for data.config. Lenient (all fields optional) so drafts can be saved.
//                   Unknown keys are stripped, so only known, size-limited fields reach MongoDB.
//   requiredFields  (config) -> list of missing field names. Checked only before a run.
//   execute         the handler that runs the node (missing = this type cannot run yet).
// Adding a node type = adding one file and one line here.
export const nodeRegistry = {
    manualTrigger,
    httpRequest,
    aiText,
    condition,
    transform,
    output,
};

export const NODE_TYPES = Object.keys(nodeRegistry);
