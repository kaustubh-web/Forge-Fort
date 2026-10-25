# Forge-fort v1 Specification

## 1. Product
Users build automation workflows by dragging nodes onto a canvas and connecting them. They configure nodes, save to MongoDB, run workflows on the backend, watch live progress, and inspect each node's input, output, status, and errors. Execution history is persisted and workflows can be re-run.

## 2. Auth
- JWT auth from day one: register, login, `GET /api/auth/me`.
- Passwords hashed (bcrypt or argon2). Tokens in the Authorization header.
- Every workflow and execution has an `owner`. All routes enforce ownership. Return 404 (not 403) for other users' resources.

## 3. Workflow JSON (one schema shared by frontend and backend)
```json
{
  "name": "string",
  "description": "string",
  "nodes": [
    { "id": "string", "type": "manualTrigger|httpRequest|aiText|condition|transform|output",
      "position": { "x": 0, "y": 0 }, "data": { "label": "string", "config": {} } }
  ],
  "edges": [
    { "id": "string", "source": "nodeId", "target": "nodeId", "sourceHandle": "true|false|null" }
  ]
}
```
Validate with Zod or Joi on the server: node types, per-type configs, unique IDs, edges referencing real nodes, valid handles, size limits.

## 4. Limits (all configurable by env, these are defaults)
- Max 50 nodes, 100 edges per workflow
- Node timeout 30s default (max 120s); workflow timeout 5 min
- HTTP response size limit 1 MB; max 5 redirects
- Rate limiting on auth routes and execute route
- Max retry attempts per node: 5

## 5. Execution engine rules
See `docs/ARCHITECTURE.md` for the full flow. Required behavior:
1. Validate graph and node configs. Reject: malformed graphs, unknown node types, invalid connections, cycles, zero or multiple triggers, oversized graphs.
2. Kahn's algorithm for topological order and cycle detection. BFS only for reachability checks.
3. Sequential execution in dependency order. Never run a node twice.
4. Edge-state model for branching: each edge is `pending`, `active`, or `inactive`. A node runs only when all its incoming edges are resolved and at least one is `active`; otherwise it is `skipped` (with a reason) and its outgoing edges become `inactive`.
5. Condition nodes mark the matching handle's edges `active` and the other handle's edges `inactive`.
6. Execution context: executionId, workflowId, input, node outputs, node statuses, timestamps, errors, cancellation state.
7. Expressions `{{nodes.nodeId.output.field}}` resolved by a safe path resolver. No eval, no Function.
8. Per-node retry policy (max attempts, backoff, transient errors only), per-node timeout, workflow timeout.
9. Persist state after every node so partial results survive failures.
10. Cancellation via AbortController passed into HTTP and AI calls. Cancel stops further nodes and marks the execution `cancelled`.
11. On node failure (after retries): mark node `failed`, mark remaining unrun nodes `skipped` with reason "upstream failed", mark the execution `failed`. Keep partial results.
12. On server boot, mark any execution still `running` as `failed` with reason "server restarted".
13. Return meaningful errors. Never swallow exceptions.

Node statuses: `idle`, `running`, `success`, `failed`, `skipped`.
Execution statuses: `running`, `completed`, `failed`, `cancelled`.

## 6. Node registry
A backend registry where each node type defines: config schema, execute handler, output shape. Adding a node means adding one file and registering it.

## 7. Node specs
**Manual Trigger** (`manualTrigger`): accepts optional JSON input from the Run dialog. Output: the input.

**HTTP Request** (`httpRequest`)
- Config: method (GET/POST/PUT/PATCH/DELETE), url, query params, headers, JSON body, timeout, retry policy.
- Output: `{ status, headers, body }` (body parsed as JSON when possible).
- Retry only transient failures (network errors, 429, 502, 503, 504, timeouts).
- SSRF protection: only http/https; resolve DNS and block localhost, private ranges, link-local, and cloud metadata IPs (including IPv6 equivalents); re-validate every redirect; limit redirects; enforce response-size limit; guard against DNS rebinding by connecting to the validated IP.

**AI Text Processing** (`aiText`)
- Modes: summarize, classify, extract JSON, generate.
- Config: mode, model, instructions, input (expression), categories (classify), JSON schema (extract).
- Output: summarize/generate `{ text }`; classify `{ category }`; extract `{ data }`.
- Validate model output (JSON parse and schema check for classify/extract). Retry malformed output a bounded number of times, then fail with a clear error.
- Provider (Gemini or OpenAI) selected by env vars. Keys never reach the frontend.

**Condition** (`condition`)
- Config: left (expression or value), operator, right.
- Operators: equals, notEquals, contains, greaterThan, lessThan, isEmpty, isNotEmpty.
- Handles: `true` and `false`.

**Transform Data** (`transform`)
- Config: ordered list of operations: select fields, rename fields, filter array, map values, merge objects, convert type (string, number, boolean, date).
- Predefined operations only. No user code.

**Log / Output** (`output`)
- Config: message template and selected data (expressions).
- Writes to the execution log and becomes part of the final result.

## 8. Live updates
- SSE at `GET /api/executions/:id/stream`. Events: `workflow.started`, `node.started`, `node.completed`, `node.failed`, `node.skipped`, `workflow.completed`, `workflow.failed`, `workflow.cancelled`.
- Native `EventSource` cannot send an Authorization header. Decide between a fetch-based stream reader and a short-lived stream token, and record the choice in `docs/decisions/`.
- State is persisted in MongoDB. After a refresh, the frontend rehydrates from the persisted execution and reconnects to the stream if still running.

## 9. Models
- **User**: email, passwordHash, createdAt
- **Workflow**: name, description, nodes, edges, owner, timestamps
- **WorkflowExecution**: workflow ref, owner, status, input, startedAt, endedAt, node records (nodeId, type, status, input, output, attempts, error, startedAt, endedAt, skipReason), error details, metadata
- Never store plaintext secrets in workflow JSON or logs. Redact authorization headers, API keys, tokens.

## 10. REST API
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/workflows`, `GET /api/workflows`, `GET /api/workflows/:id`, `PUT /api/workflows/:id`, `DELETE /api/workflows/:id`, `POST /api/workflows/:id/duplicate`
- `POST /api/workflows/:id/execute` (returns 202 with executionId, runs in the background)
- `GET /api/workflows/:id/executions`, `GET /api/executions/:id`, `GET /api/executions/:id/stream`, `POST /api/executions/:id/cancel`
- Envelope: `{ success, data }` or `{ success: false, error: { code, message, details } }`.
- Correct status codes, centralized error handler, request validation, helmet, CORS config, rate limiting.

## 11. Frontend
See `docs/DESIGN.md` for visuals. Features:
- Dashboard: list, create, edit, duplicate, delete workflows.
- Editor: node sidebar, drag-and-drop canvas, config panel, toolbar (Save, Run, Stop, status), execution log panel, zoom/pan/fit/minimap, delete and duplicate nodes.
- Node states shown on canvas; executed path highlighted.
- Client-side validation errors shown before run (no trigger, disconnected nodes, missing config, cycles).
- Execution history list with rerun.

## 12. Example workflows (seed script `npm run seed` plus README steps)
1. Manual Trigger -> AI Text Processing -> Output (summarize user text)
2. Manual Trigger -> HTTP Request (real public API) -> Condition -> Transform (true branch) / Output (false branch) -> Output
3. Manual Trigger -> HTTP Request -> AI Text Processing (classify or summarize the response) -> Output

## 13. Tests (Vitest or Jest, supertest, mongodb-memory-server; mock all external APIs and AI)
Graph validation, cycle detection, topological order, conditional branching and skipping (including a diamond graph), output passing and expression resolution, invalid config rejection, retry behavior, failure propagation with partial persistence, cancellation, SSRF blocking (including redirect to a private IP), REST validation and ownership checks, execution history persistence.

## 14. Phases (finish, test, verify, and write the walkthrough before the next)
1. Setup: structure, Express, Mongo connection, env validation, React app, auth.
2. React Flow editor: drag/drop, connect, config panels, JSON serialization, save/load.
3. Engine: validation, Kahn, expressions, Trigger/Condition/Transform/Output, tests.
4. HTTP (with SSRF) and AI nodes, retries, timeouts, cancellation.
5. Persistence, dashboard, history, rerun, SSE live updates.
6. Security hardening, rate limits, redaction, full test pass, README, deployment notes.

## 15. Deliverables
Source code, directory structure, `.env.example` files (no secrets), `.gitignore`, MongoDB Atlas setup steps, AI provider config steps, install/start commands, API docs, example workflows with reproduction steps, tests, walkthroughs, decision notes, and a README covering architecture, execution flow, limitations (single instance, in-process execution, no parallelism), and future work (Delay, Approval with resumable execution, AI Agent with 1-2 tools, queue-based workers).
