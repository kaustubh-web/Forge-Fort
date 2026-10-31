# Phase 5: runs from the app, persistence, live updates, history

## 1. What was built
- `POST /api/workflows/:id/execute` validates the **saved** workflow, creates a `WorkflowExecution` record, answers 202 at once and runs the engine in the background.
- Every node change is saved to MongoDB before anyone is told about it. A crash, Stop or restart therefore leaves partial results behind.
- An SSE stream (`GET /api/executions/:id/stream`) sends a snapshot of the saved state, then live events. The browser reads it with `fetch`, so the normal Bearer token works.
- Stop really cancels the run (an in-memory `AbortController` per run). On boot, runs left `running` are marked `failed` ("server restarted").
- Secrets are redacted by key name before anything is stored or streamed.
- Frontend:
  - a Run dialog (JSON input; saves first);
  - Stop and a status badge;
  - live node colours and the animated executed path;
  - a log panel (order, timings, attempts, skip reasons, input/output JSON);
  - a History dialog with open and rerun;
  - `?run=` in the URL, so a refresh picks the run back up.
- The HTTP node fails early and clearly when an expression in its URL is empty.
- Tests: backend 259, frontend 31 (all mocked, no internet).

## 2. Flow map
```
frontend
  pages/Editor.jsx  runWorkflow(input) -> save() -> useExecution.start() -> setSearchParams({ run })
  hooks/useExecution.js  start(): lib/executionApi.js executeWorkflow()  ->  connect(executionId)
                         connect(): lib/executionStream.js openExecutionStream(id, { onEvent, onEnd, onError })
                                    onEvent -> reducer -> lib/executionState.js applyEvent()   (forward-only)
                                    final workflow.* -> getExecution() refetch (outputs, logs, endedAt)
                                    onError (5xx/network) -> retry after 1, 2, 5, 10 s; 4xx -> stop
  Editor: displayNodes = nodeStatuses(execution) -> NodeCard status dot
          displayEdges = executedEdgeIds(execution, edges) -> animated green edges
          components/editor/ExecutionLogPanel.jsx, RunHistoryDialog.jsx (listExecutions)

backend
  routes/workflowRoutes.js  POST /:id/execute  validate(schema/execution.js executeSchema)
   -> controllers/executionController.js execute
   -> services/executionService.js executeWorkflow(ownerId, workflowId, input)
        getWorkflow (404 if not yours) -> engine/validateForRun.js (400 INVALID_WORKFLOW)
        WorkflowExecution.create({ status: "running", input: redactDeep(input), nodes: idle records in run order })
        executions/executionRunner.js startExecution({ execution, workflow, input })   (not awaited)
   <- 202 { executionId }
  executionRunner.run():
        executions/runningExecutions.js register(id) -> signal
        engine/runWorkflow.js runWorkflow({ workflow, input, signal, emit })
          emit(event): utils/redact.js redactDeep -> WorkflowExecution.updateOne($set nodes.<i>, status)
                       -> executions/executionHub.js publish(id, event)
          final event held back until outputs, logs, endedAt are saved
        crash -> failExecution() (running -> failed, idle -> skipped) + publish workflow.failed
        finally: unregister(id)
  routes/executionRoutes.js
    GET  /:id/stream -> controllers/streamController.js streamExecution
           hub.subscribe() FIRST (buffer), then getExecution() -> write("snapshot"), flush buffer,
           then live events; end after the final event; ": ping" every 15 s; unsubscribe on close
    POST /:id/cancel -> executionService.cancelExecution -> runningExecutions.cancel(id) (409 NOT_RUNNING)
  server.js  markInterruptedExecutions() before app.listen
```

## 3. One concrete trace: Workflow 2, input `{ "todoId": 4 }`
Recorded through the real API (the end-to-end check in step 13).

1. The editor saves the workflow, then calls `POST /api/workflows/<id>/execute` with `{"input":{"todoId":4}}`.
   - The server validates the graph and computes the order: `trigger-1, http-1, check-1, done-1, pending-1, output-1`.
   - It inserts the execution with 6 `idle` records and returns `202 { executionId }`.
2. The browser opens the stream. The first event is `snapshot` (status `running`). `workflow.started` usually fires before the stream connects. Then it isn't sent separately, and the snapshot already reflects it. If it does arrive, the reducer ignores it, since the status is already `running`.
3. **trigger-1** (`node.started`, `node.completed`) outputs `{ "todoId": 4 }`.
4. **http-1**:
   - The URL `.../todos/{{input.todoId}}` becomes `.../todos/4`. It isn't empty, so the request is sent.
   - Output: `{ status: 200, headers: {...}, body: { userId: 1, id: 4, title: "et porro tempora", completed: true } }`.
5. **check-1**:
   - `{{nodes.http-1.output.body.completed}}` resolves to `true`, which `equals "true"`, so `branch: "true"`.
   - Edge e3 (to done-1) becomes `active`; e4 (to pending-1) becomes `inactive`.
6. **done-1** (Transform) runs, because e3 is active. Select `body`, then rename it to `todo`, gives `{ todo: { userId: 1, id: 4, title: "et porro tempora", completed: true } }`.
7. **pending-1** gets `node.skipped`. Its only incoming edge (e4) is inactive, so the reason is "Condition 'check-1' took the true branch". Its outgoing edge e6 becomes inactive.
8. **output-1** runs: e5 is active, and one active edge is enough (the converging-inputs rule).
   - Message: "Checked todo 4 (HTTP 200): completed = true".
   - Data: `{ title: "et porro tempora" }`.
9. `outputs`, `logs` and `endedAt` are saved, and then `workflow.completed` is sent. The stream closes. The hook refetches `GET /executions/:id`, so the log panel shows the total duration and the Output message.
10. On the canvas, e1, e2, e3 and e5 are animated green. pending-1 is dimmed, and e4 and e6 stay grey.

With `{ "todoId": 1 }` it's the mirror image: `completed: false`, so pending-1 runs and done-1 is skipped ("took the false branch").

## 4. See it working
Start the backend with `npm run dev` (in `backend/`) and the frontend with `npm run dev` (in `frontend/`). Seed once: `npm run seed -- you@example.com`.
- **UI:**
  1. Open "Todo status check", click **Run**, enter `{"todoId": 4}` and run it. The dots go blue, then green, one node after another. The true-branch edges animate, and the log panel fills in.
  2. Expand the `Get todo` row to see the real HTTP output.
  3. Refresh the page: the same run comes back (`?run=` in the URL).
  4. Click **History**, then click an older run, then **Rerun**.
- **API (bash):**
  ```bash
  TOKEN=$(curl -s -X POST localhost:4000/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","password":"..."}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
  curl -s -X POST localhost:4000/api/workflows/<workflowId>/execute -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"input":{"todoId":4}}'          # 202 { executionId }
  curl -N localhost:4000/api/executions/<executionId>/stream -H "Authorization: Bearer $TOKEN"
  curl -s localhost:4000/api/executions/<executionId> -H "Authorization: Bearer $TOKEN"
  curl -s localhost:4000/api/workflows/<workflowId>/executions -H "Authorization: Bearer $TOKEN"
  ```
  For a run that already finished, the stream prints one `event: snapshot` and closes. For a live run you see the `node.*` events arrive one at a time.

## 5. Break it on purpose
1. **Wrong input.** Run "Classify an API post" with `{"todoId": 1}`. Expected: http-1 fails with "URL expression {{input.postId}} is empty. Check the Run input", no request is sent, and the rest is skipped ("upstream failed").
2. **Stop mid-run.** Run Classify with `{"postId": 3}` and press **Stop** while the AI node is blue. Expected: the AI node fails with "Cancelled", the Output is skipped ("execution cancelled"), and the run is `cancelled`. Calling `POST .../cancel` again returns 409 `NOT_RUNNING`.
3. **Kill the server mid-run.** Start a run, then save any backend file (`npm run dev` restarts) or press Ctrl+C. Expected: the backend log says "Marked 1 interrupted execution(s) as failed (server restarted)". The editor shows "(reconnecting...)", then "Failed", and the log keeps the nodes that finished.
4. **Another user's run.** Log in as a second user and `curl` the first user's `/api/executions/<id>`, `/stream` and `/cancel`. Expected: 404 on all three, never 403.
5. **Invalid graph.** Delete the edge into the Output node, save, then call execute via `curl`. Expected: 400 `INVALID_WORKFLOW` with the problem in `details`, and no new entry in History.
6. **A secret in the input.** Run with `{"todoId": 4, "apiKey": "abc"}`. Expected: History and the trigger's Input in the log show `"apiKey": "[REDACTED]"`. The run itself still had `"abc"`.

## 6. Likely interview questions
1. **Why return 202 instead of waiting for the run?**
   - A run can take minutes (HTTP retries, AI calls, up to the 5-minute deadline). Holding the request open would hit proxy timeouts and tie the result to one connection.
   - 202 says "accepted, still working". The client follows progress on the stream and can always fetch the saved record.
2. **Why save before publishing each event?**
   - The saved record is the source of truth. If we published first and then crashed, a viewer could have seen a state that was never saved, and a refresh would show *less* than the screen did.
   - Saving first means the snapshot is never behind the stream.
3. **How do you avoid missing an event between "load the snapshot" and "start listening"?**
   - The stream subscribes to the hub *before* reading the snapshot and buffers events until the snapshot is sent. An event can then arrive twice, but never not at all.
   - Duplicates are harmless because the client reducer only moves a node's status forward. A test injects an event during the snapshot read to prove it.
4. **Why `fetch` instead of `EventSource`?**
   - `EventSource` cannot send an `Authorization` header. The alternative is putting a token in the URL, and URLs end up in logs and browser history.
   - With `fetch` the stream uses the same Bearer auth as every other route. We lose the built-in reconnect, but ours is simpler anyway: reconnecting just means opening the stream again and getting a fresh snapshot.
5. **What breaks if you run two server instances?**
   - The hub (who is watching) and the cancel map (which `AbortController` belongs to which run) live in one process's memory. A viewer connected to instance B never hears about a run on instance A, and Stop on B can't reach it.
   - The fix is a shared channel (Redis pub/sub or MongoDB change streams) plus a queue with workers that own runs. That's documented as future work.

## 7. Glossary
- **202 Accepted**: "I took the job, it isn't finished yet". The body carries an id to follow it.
- **SSE (Server-Sent Events)**: a long HTTP response where the server writes `event:`/`data:` blocks as things happen. It's one-way, server to client.
- **Snapshot-first stream**: every connection starts with the full saved state, so a reconnect needs no event ids or replay.
- **Hub (pub/sub)**: an in-memory map from execution id to listeners. The runner publishes, and streams subscribe.
- **Persist-then-publish**: write to the database first, then notify viewers, so the database is never behind the screen.
- **Forward-only reducer**: client state that refuses to move a node's status backwards, which makes repeated or late events harmless.
- **Boot recovery**: on startup, finishing records that a dead process left as `running`.
- **Redaction**: replacing secret-looking values with `[REDACTED]` before they're stored or sent.
- **Rehydration**: rebuilding the UI from saved data after a refresh (`?run=` in the URL, then a snapshot).
- **Heartbeat**: a comment line (`: ping`) sent every 15 s, so proxies don't close an idle connection.
