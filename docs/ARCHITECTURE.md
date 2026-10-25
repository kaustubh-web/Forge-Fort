# Execution Architecture

How a workflow goes from the canvas to persisted results. Read before touching the engine.

## 1. End-to-end flow
1. **Save**: the editor serializes the canvas to `{ nodes, edges }` JSON and sends `PUT /api/workflows/:id`. The server validates it and stores it in MongoDB.
2. **Run**: `POST /api/workflows/:id/execute` with optional trigger input.
3. **Validate** (before anything runs): schema and per-node config checks, exactly one trigger, size limits, cycle check. On failure return 400 and run nothing.
4. **Order**: compute the topological order with Kahn's algorithm.
5. **Create record**: insert a `WorkflowExecution` with status `running`, return `202 { executionId }` immediately, and run the engine in the background (in-process).
6. **Stream**: the frontend opens the SSE stream for that execution and colors nodes as events arrive.
7. **Execute loop**: run nodes in order (section 3).
8. **Finish**: set status to `completed`, `failed`, or `cancelled`, save, emit the final event.
9. **Refresh-safe**: the UI can reload the persisted execution at any time.

## 2. Kahn's algorithm (ordering and cycle detection)
- Compute each node's in-degree (number of incoming edges).
- Queue every node with in-degree 0 (the trigger).
- Pop a node, append it to the order, decrement its children's in-degrees; a child reaching 0 joins the queue.
- If the final order has fewer nodes than the graph, there is a cycle: reject the workflow.
- Why not plain BFS: when branches converge, BFS can reach a node before all its parents finished. Kahn guarantees a node comes after all its parents.

## 3. Execute loop
```
for node in topologicalOrder:
    if cancelled: stop, mark execution cancelled
    incoming = edges targeting node
    if any incoming edge is still pending: (cannot happen in topological order)
    if no incoming edge is active (and node is not the trigger):
        mark node skipped (reason), mark its outgoing edges inactive, persist, emit node.skipped, continue
    resolve {{...}} expressions in node config using context.nodes
    mark running, persist, emit node.started
    run handler with timeout + AbortController, retrying transient failures with backoff
    on success: store output in context, set outgoing edges (see section 4), persist, emit node.completed
    on final failure: mark failed, mark remaining unrun nodes skipped ("upstream failed"),
                      mark execution failed, persist, emit node.failed + workflow.failed, stop
```

## 4. Edge-state model (branching)
Every edge is `pending`, `active`, or `inactive`.
- Normal node succeeds: all its outgoing edges become `active`.
- Condition node succeeds: edges leaving the chosen handle (`true` or `false`) become `active`; edges leaving the other handle become `inactive`.
- Node skipped or failed: all its outgoing edges become `inactive`.
- A node runs only if it has at least one `active` incoming edge. If all incoming edges are `inactive`, it is skipped. This is the converging-inputs rule.

**Diamond example**
```
Trigger -> Condition -(true)-> A -> Merge -> Output
                     -(false)-> B -/
```
If Condition takes `true`: A runs, B is skipped (its only incoming edge is inactive), Merge runs because the edge from A is active, Output runs.

## 5. Context and expressions
- Context holds: executionId, workflowId, input, `nodes[nodeId] = { status, output, error }`, timestamps, cancellation state.
- Expression `{{nodes.http-1.output.body.title}}` is resolved by splitting the path on dots and walking the object. No eval, no Function, no dynamic code. Unknown paths resolve to a clear error (or an explicit empty value, as defined in SPEC).
- A string that is exactly one expression keeps the original type (number stays number); an expression inside a larger string is stringified.

## 6. Persistence
- After every node status change, update the execution document (node records, outputs, attempts, errors, timings).
- Redact secrets before writing logs or stored inputs.
- On server boot, any execution still `running` is marked `failed` (reason: server restarted), because the in-process engine died with the server.

## 7. Cancellation
- `POST /api/executions/:id/cancel` looks up the in-memory `AbortController` for that execution, calls `abort()`, and sets the cancelled flag.
- HTTP and AI calls receive the abort signal. The loop checks the flag before each node.
- Single-instance limitation: the controller map lives in process memory.

## 8. SSE
- Events: `workflow.started`, `node.started`, `node.completed`, `node.failed`, `node.skipped`, `workflow.completed`, `workflow.failed`, `workflow.cancelled`.
- Each event carries executionId, nodeId (when relevant), status, timestamp, and a small payload.
- If the stream drops, the client reconnects and rehydrates from the persisted execution.

## 9. Design choices and known limitations
- In-process, sequential execution: simple and debuggable; does not scale across multiple servers and no parallel branches.
- Persist-after-every-node: gives partial results and refresh-safe history.
- Delay and Manual Approval are deferred because they need pause/resume across requests: persisted state plus a scheduler or queue.
- AI Agent is deferred: needs a bounded tool loop, tool registry, and prompt-injection handling.
