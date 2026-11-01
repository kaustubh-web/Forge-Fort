<p align="center"><img src="docs/logo-mark.svg" width="72" alt="ForgeFort logo: a fort with a branching workflow graph"></p>

<h1 align="center">ForgeFort</h1>
<p align="center"><code>WORKFLOW AUTOMATION ENGINE</code></p>

A visual workflow builder (React Flow) with a custom Node.js execution engine. Users connect nodes on a canvas, run workflows on the backend, and inspect persisted results.

> Status: v1 complete. All six phases are done: auth, editor, engine, HTTP/AI nodes, runs from the app with live updates and history, and security hardening with an encrypted secrets vault and deployment notes. See `docs/SPEC.md` for scope, `docs/ARCHITECTURE.md` for how execution works and `docs/walkthroughs/` for a guided tour of each phase.

## Structure
- `backend/` Express + MongoDB (Mongoose) API
- `frontend/` React + Vite + Tailwind + shadcn/ui app
- `docs/` spec, architecture, design system, decisions, walkthroughs

## Prerequisites
- Node.js 22+
- MongoDB running locally (`mongodb://127.0.0.1:27017`) or a MongoDB Atlas connection string

## Setup
```bash
# Backend
cd backend
npm install
cp .env.example .env     # then edit: set MONGODB_URI, a JWT_SECRET of 32+ characters and SECRETS_KEY
npm run dev              # http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:4000/api
npm run dev              # http://localhost:5173 (the port must match CORS_ORIGIN)
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

Load the example workflows (the three SPEC examples plus the showcase) into your account (register in the app first):
```bash
cd backend
npm run seed -- you@example.com     # re-running updates them, never duplicates
```

## Example workflows
| Workflow | Run input | Needs |
|---|---|---|
| 1. Summarize text (Trigger -> AI -> Output) | `{"text": "a paragraph"}` | an AI key |
| 2. Todo status check (Trigger -> HTTP -> Condition -> Transform / Output -> Output) | `{"todoId": 1}` (false branch) or `{"todoId": 4}` (true branch) | internet |
| 3. Classify an API post (Trigger -> HTTP -> AI classify -> Output) | `{"postId": 3}` | internet and an AI key |
| **Showcase:** Trip weather advisor (11 nodes: geocoding API -> "city found?" branch -> forecast API -> Transform -> "rain likely?" branch -> AI day plan -> Output) | `{"city": "Mumbai"}` (rainy branch today), `{"city": "Dubai"}` (dry), `{"city": "Qwxzzy"}` (not found) | internet and an AI key |

Open one, click **Run**, paste the input, and watch the nodes colour in. The log panel at the bottom shows each node's input, output, timing and skip reason; **History** lists past runs.

## Deployment
Backend on Render (one instance, `render.yaml` Blueprint), frontend on Vercel (`frontend/vercel.json`), data on MongoDB Atlas. The step-by-step guide covers the least-privilege database user, network access, production secrets, free-tier behaviour and a smoke test: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Environment variables (backend)
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | 4000 |
| `MONGODB_URI` | MongoDB connection string | required |
| `JWT_SECRET` | Token signing key, min 32 chars | required |
| `JWT_EXPIRES_IN` | Token lifetime | 7d |
| `SECRETS_KEY` | Encrypts saved secrets: 64 hex characters (32 random bytes). Losing it makes saved secrets unreadable | required |
| `CORS_ORIGIN` | Allowed frontend origin | required |
| `AUTH_RATE_LIMIT` | Auth requests per IP per 15 min | 20 |
| `API_RATE_LIMIT` | Requests per IP per 15 min, all `/api` routes except `/api/health` | 600 |
| `EXECUTE_RATE_LIMIT` | Runs started per user per minute | 30 |
| `MAX_CONCURRENT_RUNS` | Executions one user can have `running` at the same time | 3 |
| `MAX_STREAMS_PER_USER` | Live-update (SSE) streams one user can have open at once | 10 |
| `TRUST_PROXY` | Proxy hops in front of the app (0 locally, 1 on Render/Railway), so rate limits see the real client IP | 0 |
| `NODE_ENV` | development / test / production | development |
| `MAX_NODES` / `MAX_EDGES` | Workflow size limits | 50 / 100 |
| `DEBUG_ENGINE` | `true` prints the engine's run order, edge states and decisions | false |
| `NODE_TIMEOUT_MS` | Per-attempt node timeout (a node's `timeoutMs` overrides it) | 30000 |
| `WORKFLOW_TIMEOUT_MS` | Whole-run deadline | 300000 |
| `HTTP_MAX_RESPONSE_BYTES` / `HTTP_MAX_REDIRECTS` | HTTP node limits | 1048576 / 5 |
| `AI_PROVIDER` | `gemini` or `openai`; empty = AI nodes fail with "not configured" | empty |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Key for the chosen provider | required for that provider |
| `AI_MODEL` | Default model id (copy it from the provider's model list) | required if a provider is set |
| `AI_OUTPUT_RETRIES` | Re-asks after a malformed AI reply | 2 |

The server validates these at startup and refuses to boot if any are missing or invalid.

## API
All responses use `{ success: true, data }` or `{ success: false, error: { code, message, details } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | no | Liveness check |
| POST | `/api/auth/register` | no | `{ email, password }` (password 8-72 chars). 201 with `{ user, token }`. 409 if the email exists. |
| POST | `/api/auth/login` | no | `{ email, password }`. 200 with `{ user, token }`. 401 for any bad credentials. |
| GET | `/api/auth/me` | Bearer token | Current user |

Send the token as `Authorization: Bearer <token>`.

### Workflows
All workflow routes need a Bearer token and only ever touch the caller's own workflows. Another user's workflow, or a malformed id, returns 404 (never 403).

| Method | Path | Description |
|---|---|---|
| POST | `/api/workflows` | Body: `{ name, description, nodes, edges }`. 201 with `{ workflow }`. 400 if the graph is invalid. |
| GET | `/api/workflows` | Summaries only (`name`, `description`, timestamps), newest first. |
| GET | `/api/workflows/:id` | The full workflow including nodes and edges. |
| PUT | `/api/workflows/:id` | Replaces the workflow. Same validation as POST. |
| DELETE | `/api/workflows/:id` | Deletes it. |
| POST | `/api/workflows/:id/duplicate` | Creates `<name> (copy)`. 201. |

### Secrets
API keys and tokens for HTTP nodes, stored encrypted (AES-256-GCM, `docs/decisions/secrets.md`). All routes need a Bearer token and only touch the caller's secrets. **No route ever returns a value.**

| Method | Path | Description |
|---|---|---|
| GET | `/api/secrets` | Names and dates only. |
| POST | `/api/secrets` | `{ name, value }`. Name: `A-Z`, `0-9`, `_`, starting with a letter (max 64). Value up to 4096 chars. 201. 409 `SECRET_EXISTS`. At most 50 per user. |
| PUT | `/api/secrets/:name` | `{ value }`: replaces the value (rotation). 404 if missing. |
| DELETE | `/api/secrets/:name` | Deletes it. Workflows using it fail validation until it exists again. |

Use a secret in an **HTTP Request** node's URL, headers, query or body as `{{secrets.NAME}}`, for example the header `Authorization: Bearer {{secrets.GITHUB_TOKEN}}`.
- On execute, only the referenced secrets are decrypted, in memory. A missing one is a 400 before anything runs.
- Any other node type using `{{secrets...}}` is rejected, because the value would land in stored outputs or an AI prompt.
- Every stored and streamed piece of a run (node inputs, outputs, errors, logs) is scanned for the decrypted values, including their URL-encoded form, and they are replaced with `[REDACTED]`. An API that echoes the token back can't leak it.
- Saving a workflow with a typed-in value in a sensitive header or query parameter (`Authorization`, `X-Api-Key`, `token`, ...) is refused with a message pointing to `{{secrets.NAME}}`. Expressions such as `Bearer {{input.token}}` are still allowed.

### Executions
All routes need a Bearer token; another user's execution or workflow returns 404.

| Method | Path | Description |
|---|---|---|
| POST | `/api/workflows/:id/execute` | Body `{ input }` (a JSON object, max 100 KB, optional). Runs the **saved** workflow. 202 `{ executionId, status: "running" }`; the engine runs in the background. 400 `INVALID_WORKFLOW` (with every problem in `details`) if the graph cannot run; nothing is created then. |
| GET | `/api/workflows/:id/executions` | The last 50 runs, newest first (summaries: status, input, error, timings). |
| GET | `/api/executions` | The newest runs across **all** your workflows (summaries with `metadata.workflowName`). Query: `status` (`running`, `completed`, `failed`, `cancelled`), `limit` (1-100, default 50). |
| GET | `/api/executions/:id` | The full persisted execution: one record per node in run order (status, input, output, attempts, attemptLog, error, skipReason, branch, timings), plus `outputs` and `logs`. |
| GET | `/api/executions/:id/stream` | Server-Sent Events, see below. |
| POST | `/api/executions/:id/cancel` | 202: the engine was asked to stop; the stream reports `workflow.cancelled`. 409 `NOT_RUNNING` if it already finished. |

**Live updates (SSE).** The stream always starts with `event: snapshot` (the execution as saved in MongoDB), then live events: `workflow.started`, `node.started`, `node.completed`, `node.failed`, `node.skipped`, then one of `workflow.completed` / `workflow.failed` / `workflow.cancelled`, after which it closes. A finished run gets only the snapshot. Node events carry the (redacted) node record. A `: ping` comment every 15 s keeps proxies from closing it. Because the native `EventSource` cannot send an `Authorization` header, the frontend reads the stream with `fetch` (`docs/decisions/sse-auth.md`). Try it:
```bash
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/executions/<executionId>/stream
```

The workflow JSON (SPEC section 3) is validated with Zod in `backend/src/schema/workflow.js`: node types, the config schema for each type (`backend/src/nodes/registry.js`), unique node ids (letters, digits, `-`, `_` only), edges that reference real nodes, `true`/`false` handles only on Condition nodes (and required there), no self-loops, no duplicate edges, at most 50 nodes and 100 edges. Unknown fields are stripped. Drafts may be incomplete: required-config and "exactly one trigger" checks happen at run time.

## Editor (frontend)
- Dashboard: list, create, duplicate and delete workflows.
- Editor at `/workflows/:id`: drag nodes from the palette, connect them, configure the selected node in the right panel. Condition nodes have labelled `true` and `false` outputs.
- Shortcuts: Ctrl+S save, Ctrl+Enter run, Delete removes the selected node, Ctrl+D duplicates it.
- A validation panel lists problems before a run (no trigger, cycles, unconnected nodes, missing config). Clicking a problem selects the node.
- **Run** opens a dialog for the trigger input (JSON). Unsaved changes are saved first, because the server runs the saved workflow. **Stop** cancels the run. The header badge shows the run status.
- While a run is going, node dots turn blue (pulsing), then green, red or dimmed (skipped), and the edges the run travelled are animated. Only the Condition branch that was taken lights up.
- The **execution log** (bottom, collapsible) lists nodes in run order with status, duration, retry attempts and skip reasons; expand a row for its input and output JSON with a copy button.
- **Settings** (sidebar) manages secrets: add, replace or delete them, and copy the `{{secrets.NAME}}` expression. A saved value is never shown again.
- **History** lists the last 50 runs of the workflow. Click one to open it, or **Rerun** it with the same input.
- **Executions** (sidebar) lists the newest runs across all workflows, with a status filter (All, Running, Completed, Failed, Cancelled). A failed row shows its error; clicking a row opens that run in its editor.
- The hamburger button collapses the sidebar to an icon rail. It starts collapsed in the editor, to leave room for the canvas, and remembers each choice.
- The URL carries the run (`/workflows/:id?run=<executionId>`), so a refresh reloads it from MongoDB and reconnects if it is still running. A dropped stream reconnects after 1, 2, 5 and 10 s.

## Execution engine
The engine lives in `backend/src/engine/`. It runs in-process and sequentially. The app runs it through `POST /api/workflows/:id/execute` (see "Running from the app" below); the CLI runner runs a JSON file directly, without the database:
```bash
cd backend
npm run engine:run -- examples/diamond.json                                # true branch
npm run engine:run -- examples/diamond.json examples/diamond-error-input.json  # false branch
npm run engine:run -- examples/pipeline.json
npm run engine:run -- examples/http-condition.json                         # Workflow 2, real public API
npm run engine:run -- examples/ai-summarize.json                           # Workflow 1, needs an AI key
npm run engine:run -- examples/http-ai.json                                # Workflow 3, needs an AI key
DEBUG_ENGINE=true npm run engine:run -- examples/diamond.json              # bash; in PowerShell: $env:DEBUG_ENGINE="true"
```
Press Ctrl+C during a run to cancel it: the engine aborts the running call, skips the rest and prints the partial result.

**Execution flow** (`runWorkflow.js`)
1. `validateForRun`: schema again, exactly one trigger with no inputs, no cycles (Kahn), every node reachable from the trigger (BFS), required config filled in, the node type has a handler, and every `{{nodes.X...}}` points at an ancestor. Any problem means 400 `INVALID_WORKFLOW` with the full list, and nothing runs.
2. Topological order with Kahn's algorithm, deterministic.
3. For each node in order: stop if cancelled or past the workflow deadline; skip it if no incoming edge is `active` (with a reason such as "Condition 'check-1' took the false branch"); otherwise resolve `{{...}}` expressions and run the handler.
   - Each attempt gets an `AbortSignal` that fires on Stop, on the workflow deadline, or after the node timeout. HTTP and AI calls pass it to `fetch` / the SDK.
   - A `NodeError` with `retryable: true` (network error, timeout, HTTP 429/502/503/504, AI rate limit or 5xx) is retried with exponential backoff (`backoffMs`, x2 each time, max 30 s, at least `Retry-After`) up to `maxAttempts`. HTTP and AI default to 3 attempts / 1 s. Everything else fails at once. Each failed attempt is kept in the node record's `attemptLog`.
   - Stop mid-node: that node is `failed` ("Cancelled"), the rest `skipped` ("execution cancelled"), execution `cancelled`. Deadline: execution `failed`, rest skipped ("workflow timed out").
4. Edge states: success makes outgoing edges `active`. A Condition activates only its chosen handle. Skipped and failed nodes make outgoing edges `inactive`.
5. On a failure: the node is `failed`, every remaining node is `skipped` ("upstream failed"), the execution is `failed`, and partial results are kept.
6. Every state change is emitted as a SPEC event (`node.started`, `node.skipped`, ...) and awaited, so the engine waits until it is saved.

**Running from the app** (Phase 5): route -> `executionController.execute` -> `executionService.executeWorkflow` (ownership, `validateForRun`, insert a `WorkflowExecution` with status `running` and one `idle` record per node in run order) -> 202 -> `executionRunner.startExecution` (in the background) -> `runWorkflow`. For every event the runner's `emit`:
1. redacts it (`redactDeep`),
2. saves it (`$set` of that node's record and the execution status),
3. then publishes it to the in-memory hub (`executions/executionHub.js`), which writes it to every open SSE stream.

Saving before publishing means a refresh never shows less than the stream did. The final `workflow.*` event is held back until `outputs`, `logs` and `endedAt` are saved. Stop goes through an in-memory `Map<executionId, AbortController>` (`executions/runningExecutions.js`). If the engine crashes unexpectedly, the runner marks the execution `failed` and publishes that; it is never swallowed. On boot, any execution still `running` is marked `failed` ("server restarted"), because its engine died with the old process.

**Expressions**: `{{nodes.<id>.output.<path>}}`, `{{input.<path>}}` (trigger input), and `{{item.<path>}}` (Transform map only). A whole-string expression keeps its type; embedded ones become text. A missing field is empty, but a reference to a node that did not run is an error. One exception: in the HTTP node's URL an empty expression fails the node before any request ("URL expression {{input.postId}} is empty. Check the Run input"), because `/posts/{{input.postId}}` would otherwise quietly fetch `/posts/`. The resolver only walks own properties and rejects `__proto__`/`prototype`/`constructor`. There is no eval (`docs/decisions/expressions.md`).

**Nodes** (`backend/src/nodes/`, one file each, registered in `registry.js`)
| Type | Runs? | Output |
|---|---|---|
| `manualTrigger` | yes | the run input |
| `condition` | yes | its input, unchanged, plus a `true`/`false` branch. Operators: equals, notEquals, contains, greaterThan, lessThan, isEmpty, isNotEmpty |
| `transform` | yes | the input after the ordered operations: select, rename, filter, map, merge, convert (string/number/boolean/date) |
| `output` | yes | `{ message, data }`; the message also goes to the execution log |
| `httpRequest` | yes | `{ status, headers, body }`; body parsed as JSON when possible, sensitive headers redacted. Status >= 400 fails the node (retried only for 429/502/503/504). |
| `aiText` | yes | summarize/generate `{ text }`, classify `{ category }`, extract `{ data }` |

A node's input is the output of its first active parent. Any other earlier node can be read with an expression.

**HTTP Request and SSRF** (`backend/src/net/`, `docs/decisions/ssrf.md`): only http/https; the hostname is resolved and every address must be public (allow-list via ipaddr.js: loopback, private, link-local/metadata, CGNAT, unique-local IPv6, IPv4-mapped forms are all blocked); the socket connects to exactly the checked address (DNS-rebinding safe); redirects are followed by hand (max 5) and each hop is re-checked, dropping credentials on cross-origin hops; the body is cut off at 1 MB. Config: method, URL, query params, headers (`Host`, `Content-Length` and other connection headers cannot be set), JSON body (not for GET/DELETE), `timeoutMs`, `retry`.

**AI Text** (`backend/src/ai/`, `docs/decisions/ai-provider.md`): Gemini or OpenAI by `AI_PROVIDER`, official SDKs with their own retries turned off. User input is wrapped in `<input>` tags and capped at 20,000 characters. Classify and extract use JSON mode; the category must be one of the configured ones, and extract output must match the node's JSON schema (supported keywords: `type`, `properties`, `required`, `items`, `enum`). A bad reply is re-asked with the exact problem up to `AI_OUTPUT_RETRIES` times, then the node fails.

## Tests
```bash
cd backend && npm test     # API + engine tests, in-memory MongoDB
cd frontend && npm test    # helpers: graph validation and conversion, execution state reducer, SSE reader
cd frontend && npm run build
```
The backend tests use an in-memory MongoDB, so they never touch your real database. React components do not have automated tests yet; their logic lives in tested helpers in `frontend/src/lib/`.

## Security notes
The full review, with what was fixed and what was checked, is in **[docs/security-review.md](docs/security-review.md)**.
- **Passwords:** bcrypt with 12 rounds, limited to 72 *bytes* (bcrypt's real limit); the hash is never returned. Login gives the same error, and takes the same time, for an unknown email and a wrong password.
- **JWT:** signed and verified with HS256 only. A malformed token, or one with an invalid subject, gets 401.
- **Every route** except register, login and health needs a token, and every query filters by owner: another user's id returns 404.
- **Abuse limits:**
  - rate limits per IP on auth and on the whole API, and per user on starting runs;
  - at most `MAX_CONCURRENT_RUNS` running executions and `MAX_STREAMS_PER_USER` open streams per user;
  - oversized bodies get 413.
- **helmet**, and CORS limited to one origin.
- **Keys:** server secrets live only in gitignored `.env` files and are checked at boot. AI keys are read only by `backend/src/ai/` and never logged.
- **Saved secrets** are encrypted with AES-256-GCM. They are allowed only in HTTP nodes and are never returned by the API (`docs/decisions/secrets.md`).
- **Redaction** happens before anything is stored, streamed or printed:
  - by key name (`authorization`, `apiKey`, `token`, `password`, ...), via `redactDeep`;
  - by value, for every decrypted secret, including its URL-encoded form.
- **HTTP node:** SSRF protection (see "HTTP Request and SSRF" above). Header names and values are validated, and sensitive response headers are redacted.
- **No eval anywhere:** expressions are path lookups, and the AI extract schema is checked by walking it as data.

## Limitations
- The auth token is stored in `localStorage` (see `docs/decisions/auth-storage.md`).
- Execution is in-process and sequential: no parallel branches, single server instance. The SSE hub and the cancel map live in process memory, so a viewer or a Stop must reach the server that runs the execution.
- A server restart (including `npm run dev` reloading after a backend file is saved) kills running executions; they are marked `failed` ("server restarted") on the next boot.
- Redaction is by key name. A secret under an innocent name is not caught, and a harmless field such as `tokenCount` is hidden.
- Rerun uses the stored, redacted input, so a field like `apiKey` is sent as `"[REDACTED]"`.
- Node events carry the full node record, so a large HTTP response (up to 1 MB) is sent to the browser in full.
- Rate-limit counters, the concurrent-run cap and the stream cap live in process memory (single instance). The concurrent-run cap counts `running` records and then inserts, so two runs started in the same instant can both slip past it. An atomic counter would close that gap.
- History shows the last 50 runs per workflow and the Executions page up to 100; there is no paging. The log panel is collapsible but not resizable.
- The frontend ships as one JavaScript bundle of about 800 KB, or 250 KB gzipped (Vite warns about it); the editor isn't code-split yet.
- HTTP node: any port on a public host is reachable; an HTTP status >= 400 fails the node (a Condition cannot branch on a 404); a JSON body built from expressions breaks if a value contains quotes (use a whole-body expression instead).
- Secrets protect against a leaked database, not a compromised server: `SECRETS_KEY` lives next to the app. A KMS would be the next step. There is no key rotation yet (stored values carry a `v1` prefix for it).
- Only sensitive header and query names are checked for typed-in credentials. A JSON body can't be checked reliably; use `{{secrets.NAME}}` there too. Secret values shorter than 4 characters are not masked by value.
- Aborting an AI call stops the wait, but the provider may still bill for work already done.
- The "unsaved changes" warning only covers closing or reloading the tab, not clicking a link inside the app.

## Future work
The v1 design leaves room for these. Each one notes what it needs.
- **Delay node.** Waiting minutes or days inside the in-process loop would hold the run in memory and die on a restart. It needs pause and resume:
  - persist the run as `waiting` with a wake-up time;
  - a scheduler picks it up and continues from the stored context.
  - The node records and edge states are already saved after every node, so the engine can restart from the first unfinished node.
- **Manual Approval node.** Same pause and resume, but woken by a person:
  - the run stops as `waiting` (the amber status colour is reserved for it);
  - an `approve` / `reject` route resumes it down the matching handle, as a Condition does.
- **AI Agent node.** A bounded tool loop: the model can call one or two registered tools (for example an HTTP GET through the same SSRF guard), with a step limit, a token budget and every tool call shown in the log. Tool results are untrusted input, so they are fenced like user text against prompt injection.
- **Queue-based workers.** Move runs out of the API process into a job queue (for example BullMQ on Redis). Workers execute and publish events through Redis pub/sub, so SSE, Stop and the rate limits work across several instances, and a deploy no longer kills runs. This removes the "single instance" limitation above.
- **Smaller items:**
  - parallel branches (independent nodes in the same Kahn layer);
  - `SECRETS_KEY` rotation (the `v1` prefix is in place) or a cloud KMS;
  - an httpOnly-cookie session instead of `localStorage`;
  - code-splitting the editor;
  - paging for history.
