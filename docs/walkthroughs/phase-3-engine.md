# Phase 3: The execution engine

## 1. What was built
- A run-time validator that refuses to start a workflow that cannot run, and lists every problem at once.
- Kahn's algorithm, which gives the run order and detects cycles in one pass.
- An edge-state model (`pending` / `active` / `inactive`) that decides which branch runs and which nodes are skipped, and why.
- A safe expression resolver for `{{nodes.<id>.output.x}}`, `{{input.x}}` and `{{item.x}}`. It only walks paths and never evaluates code.
- Handlers for Manual Trigger, Condition, Transform (6 operations) and Output. HTTP and AI keep their schemas and get handlers in Phase 4.
- The engine loop `runWorkflow()`, with failure propagation, partial results, cancellation, SPEC events and debug logging.
- A CLI runner (`npm run engine:run`) and two offline example workflows. No API route yet.
- Tests: 92 backend tests (37 from before + 55 engine tests).

## 2. Flow map
```
backend/scripts/run-workflow.js            (Phase 5: POST /api/workflows/:id/execute -> service)
 -> engine/runWorkflow.js   runWorkflow({ workflow, input, signal, emit })
    -> engine/validateForRun.js  validateForRun(raw)
         schema/workflow.js      workflowSchema.safeParse        (shape, per-type config)
         engine/graph.js         buildGraph -> topologicalSort (Kahn, cycles) -> reachableFrom (BFS)
         nodes/<type>.js         requiredFields(config), execute exists?
         engine/expressions.js   findExpressions -> graph.ancestorsOf   (refs must be ancestors)
         throws AppError(400, "INVALID_WORKFLOW", issues)  or returns { workflow, graph, order }
    -> loop over order:
         signal.aborted?             -> skipAll("execution cancelled"), status "cancelled"
         no active incoming edge?    -> skip(nodeId, skipReasonFor(incoming)) -> outgoing "inactive"
         executeNode()
           engine/expressions.js  resolveConfig(config, { nodes: context.nodes, input })
           nodes/registry.js      nodeRegistry[type].execute({ config, input, signal, log, node })
             nodes/condition.js   -> engine/compare.js compare() -> { output, branch }
             nodes/transform.js   -> operations[op.type](data, op), one after another
             nodes/output.js      -> log(message), { message, data }
         success -> setOutgoing(active, or only the edges on `branch`) -> emit node.completed
         NodeError -> node failed, skipAll("upstream failed"), status "failed", emit node.failed
    -> emit workflow.completed | failed | cancelled, return { status, nodes, outputs, logs, error }
```

## 3. One concrete trace: `examples/diamond.json` with `status: 500`
Input: `{ "status": 500, "orders": [{ "id": "A-1", "customer": "Ann", "total": "120" }] }`

0. **Validate.** One trigger, no cycle, everything reachable, all configs filled in. `output-1` refers to `merge-1`, which is its ancestor, so that is fine. **Kahn**: in-degrees are trigger 0, check 1, big-orders 1, unavailable 1, merge 2, output 1. The order is `trigger-1 -> check-1 -> big-orders -> unavailable -> merge-1 -> output-1`. `merge-1` only enters the queue after **both** of its parents.
1. **trigger-1** has no incoming edges and always runs. Input and output are the run input. Edge `e1` becomes `active`.
2. **check-1**: `e1` is active, so it runs. `{{input.status}}` is a whole-string expression, so it resolves to the **number** 500. `compare(500, "equals", "200")`: both are numeric, so they are compared as numbers and the result is false. It returns `{ output: <its input>, branch: "false" }`. `e2` (true handle) becomes `inactive` and `e3` (false handle) becomes `active`.
3. **big-orders**: its only incoming edge, `e2`, is inactive. It is **skipped**, with reason `Condition 'check-1' took the false branch`. Its outgoing edge `e4` becomes `inactive`.
4. **unavailable**: `e3` is active. Its input is check-1's output, which is the original input passed through. The map operation sets `note: "status unavailable"` on every order. `e5` becomes `active`.
5. **merge-1**: incoming `e4` is inactive and `e5` is active. At least one is active, so it **runs** (the converging-inputs rule). Its input is the output of the first active parent, `unavailable`. The select operation keeps only `orders`.
6. **output-1**: the message `First note: {{nodes.merge-1.output.orders.0.note}}` becomes `First note: status unavailable` and is written to the log. Its data `orders` keeps the real array, because it was a whole-string expression.
7. The status is `completed`, and `outputs = { "output-1": { message, data } }`.

## 4. See it working
```bash
cd backend
npm test                                                                   # 92 passed
npm run engine:run -- examples/diamond.json                                # big-orders runs, unavailable skipped
npm run engine:run -- examples/diamond.json examples/diamond-error-input.json  # the reverse
npm run engine:run -- examples/pipeline.json                               # "From crm: Ann (31), Cy (45)"
```
Debug output (PowerShell: `$env:DEBUG_ENGINE="true"; npm run engine:run -- examples/diamond.json examples/diamond-error-input.json`, then `Remove-Item Env:DEBUG_ENGINE`):
```
[engine] order: trigger-1 -> check-1 -> big-orders -> unavailable -> merge-1 -> output-1
[engine] run check-1 (condition)
[engine]   edge e2: inactive
[engine]   edge e3: active
[engine] skip big-orders: Condition 'check-1' took the false branch
[engine]   edge e4: inactive
```
The CLI prints one line per node in run order, with its status, duration and branch or skip reason, then the log lines and the outputs.

## 5. Break it on purpose
Copy `examples/diamond.json` to a scratch file, edit it, and run it with `engine:run`.
1. **Cycle**: add the edge `{ "id": "back", "source": "output-1", "target": "check-1", "sourceHandle": null }`. Expected: `Workflow cannot run`, with every node from check-1 onwards "is part of (or behind) a cycle". Nothing runs.
2. **Two triggers**: add a second `manualTrigger` node. Expected: `The workflow has 2 triggers, only one is allowed` (it is also "not connected", because only one trigger can be the start).
3. **Reference a node that does not run first**: in `big-orders`, set a map value to `{{nodes.unavailable.output.orders}}`. Expected: `Node "big-orders" refers to "unavailable", which does not run before it`. It is a sibling, not an ancestor.
4. **Bad data at run time**: add `{ "type": "convert", "params": { "field": "orders", "to": "number" } }` to `merge-1`. Expected: status FAILED, merge-1 `failed` with `Operation 2 (convert): Cannot convert "orders" ([{"id":...) to a number`, output-1 `skipped: upstream failed`, and the earlier nodes keep their outputs.
5. **Try to run code**: set the condition's left to `{{process.exit()}}` or `{{input.__proto__}}`. Expected: rejected by validation (`must start with nodes, input or item` / `uses a forbidden key`). Nothing is evaluated.

Cancellation has no CLI or route yet. See the `runWorkflow: cancellation` test, which aborts the `AbortController` after the first node.

## 6. Likely interview questions
1. **Why Kahn's algorithm and not BFS or DFS?** Kahn releases a node only after its last parent is done, so converging branches are safe. It also detects cycles for free: any node left over was never released. Plain BFS can visit a merge node before its slower parent.
2. **How does branching work without the engine knowing about Conditions?** Every edge has a state. A handler may return a `branch`. If it does, only edges whose `sourceHandle` matches become active, and the rest become inactive. A node runs if at least one incoming edge is active. Otherwise it is skipped, and its outgoing edges become inactive, so the skip spreads.
3. **In the diamond, why does Merge run when one parent was skipped?** The rule is "at least one active input", not "all inputs active". The skipped branch's edge is inactive (resolved, not pending), so nothing is waiting for it.
4. **How do you prevent code injection in expressions?** There is no evaluation at all. The text in braces is split on dots and walked over own properties only. Prototype keys are rejected, and only three roots exist. Validation also rejects references to nodes that are not ancestors before anything runs.
5. **What happens when a node fails halfway through?** The node is marked failed with a clear message. Every remaining node is skipped with "upstream failed", and the execution is failed. The outputs that already exist are kept. Errors that are not `NodeError` are treated as bugs: they are logged with their stack, never swallowed.

## 7. Glossary
- **Topological order**: an order of the nodes where every edge points forward (each parent comes before its children).
- **In-degree**: the number of incoming edges of a node.
- **Kahn's algorithm**: repeatedly take a node with in-degree 0, then lower its children's in-degrees. Leftover nodes mean there is a cycle.
- **Edge state**: `pending` (source not finished), `active` (data flows), `inactive` (branch not taken, or source skipped or failed).
- **Converging-inputs rule**: a node runs if at least one incoming edge is active, and is skipped if all are inactive.
- **Ancestor**: any node with a path to this one. Only ancestors' outputs may be referenced.
- **Prototype pollution**: changing `Object.prototype` through keys like `__proto__`. It is blocked by refusing those keys and reading own properties only.
- **AbortController / AbortSignal**: the standard way to cancel async work. The engine checks `signal.aborted` before each node.
- **NodeError**: an expected, explainable node failure. Its `retryable` flag drives Phase 4 retries.
- **emit hook**: an awaited callback for every state change. Phase 5 uses it to persist the execution and stream SSE events.
