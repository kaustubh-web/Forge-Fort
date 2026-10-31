import { workflowSchema } from "../schema/workflow.js";
import { nodeRegistry } from "../nodes/registry.js";
import { AppError } from "../utils/AppError.js";
import { buildGraph, topologicalSort, reachableFrom, ancestorsOf } from "./graph.js";
import { findExpressions } from "./expressions.js";

// Run-time validation: everything that must be true before a single node runs.
// Saving is lenient (drafts may be unfinished). Running is strict. On any problem we throw
// 400 INVALID_WORKFLOW with the full list of issues, and nothing runs.
//
// Returns { workflow, graph, order, secretNames } so the engine does not repeat the work.
// secretNames: every {{secrets.NAME}} the workflow uses; the service loads exactly those.
export function validateForRun(rawWorkflow) {
    // 1. Shape. The stored workflow was validated when saved, but it is parsed again: the data
    //    could predate a schema change, and the engine must never trust its input.
    const parsed = workflowSchema.safeParse(rawWorkflow);
    if (!parsed.success) {
        const details = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
        throw new AppError(400, "INVALID_WORKFLOW", "Workflow is not valid", details);
    }
    const workflow = parsed.data;
    const graph = buildGraph(workflow.nodes, workflow.edges);

    const issues = [];
    const add = (nodeId, message) => issues.push({ nodeId, message });
    const secretNames = new Set();

    // 2. Exactly one trigger, and nothing flows into it.
    const triggers = workflow.nodes.filter((node) => node.type === "manualTrigger");
    if (triggers.length === 0) add(null, "The workflow needs a Manual Trigger");
    if (triggers.length > 1) add(null, `The workflow has ${triggers.length} triggers, only one is allowed`);
    for (const trigger of triggers) {
        if (graph.incoming.get(trigger.id).length) add(trigger.id, `Trigger "${trigger.id}" cannot have incoming connections`);
    }

    // 3. No cycles (Kahn). Without this, a node on a cycle would wait for itself forever.
    const { order, cyclic } = topologicalSort(graph);
    for (const id of cyclic) add(id, `Node "${id}" is part of (or behind) a cycle`);

    // 4. Every node reachable from the trigger (BFS). An unreachable node could never run.
    if (triggers.length === 1) {
        const reachable = reachableFrom(graph, triggers[0].id);
        for (const node of workflow.nodes) {
            if (!reachable.has(node.id)) add(node.id, `Node "${node.id}" is not connected to the trigger`);
        }
    }

    for (const node of workflow.nodes) {
        const definition = nodeRegistry[node.type];
        const config = node.data.config;

        // 5. The type can actually run (HTTP and AI handlers arrive in Phase 4).
        if (!definition.execute) add(node.id, `Node "${node.id}" (${node.type}) cannot run yet: no handler`);

        // 6. Required fields: the same rules the editor shows in its validation panel.
        const missing = definition.requiredFields(config);
        if (missing.length) add(node.id, `Node "${node.id}" is missing: ${missing.join(", ")}`);

        // 6b. Type-specific checks that go beyond "is it filled in" (e.g. the AI extract schema).
        for (const problem of definition.checkConfig?.(config) ?? []) add(node.id, `Node "${node.id}": ${problem}`);

        // 7. Expressions: valid syntax, and {{nodes.X...}} only for nodes that run before this one
        //    (ancestors). A reference to a later or unrelated node would always fail at run time.
        const ancestors = ancestorsOf(graph, node.id);
        for (const expression of findExpressions(config)) {
            if (expression.error) {
                add(node.id, `Node "${node.id}": ${expression.error}`);
            } else if (expression.root === "secrets" && node.type !== "httpRequest") {
                // A secret anywhere else would end up in stored outputs, logs or an AI prompt.
                add(node.id, `Node "${node.id}": {{secrets...}} can only be used in HTTP Request nodes`);
            } else if (expression.root === "secrets") {
                secretNames.add(expression.name);
            } else if (expression.root === "item" && node.type !== "transform") {
                add(node.id, `Node "${node.id}": {{item...}} only works inside a Transform map operation`);
            } else if (expression.root === "nodes" && !graph.nodeById.has(expression.nodeId)) {
                add(node.id, `Node "${node.id}" refers to unknown node "${expression.nodeId}"`);
            } else if (expression.root === "nodes" && !ancestors.has(expression.nodeId)) {
                add(node.id, `Node "${node.id}" refers to "${expression.nodeId}", which does not run before it`);
            }
        }
    }

    if (issues.length) throw new AppError(400, "INVALID_WORKFLOW", "Workflow cannot run", issues);
    return { workflow, graph, order, secretNames: [...secretNames] };
}
