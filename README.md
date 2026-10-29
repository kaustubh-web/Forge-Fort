# Forge-fort

A visual workflow builder (React Flow) with a custom Node.js execution engine. Users connect nodes on a canvas, run workflows on the backend, and inspect persisted results.

> Status: Phases 1-3 complete (auth, editor, execution engine). HTTP/AI nodes, the execute API and live updates arrive in Phases 4-6. See `docs/SPEC.md` for scope and `docs/ARCHITECTURE.md` for how execution works.

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
cp .env.example .env     # then edit: set MONGODB_URI and a JWT_SECRET of 32+ characters
npm run dev              # http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:4000/api
npm run dev              # http://localhost:5173 (the port must match CORS_ORIGIN)
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Environment variables (backend)
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | 4000 |
| `MONGODB_URI` | MongoDB connection string | required |
| `JWT_SECRET` | Token signing key, min 32 chars | required |
| `JWT_EXPIRES_IN` | Token lifetime | 7d |
| `CORS_ORIGIN` | Allowed frontend origin | required |
| `AUTH_RATE_LIMIT` | Auth requests per IP per 15 min | 20 |
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

## API (Phases 1-2)
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

The workflow JSON (SPEC section 3) is validated with Zod in `backend/src/schema/workflow.js`: node types, the config schema for each type (`backend/src/nodes/registry.js`), unique node ids (letters, digits, `-`, `_` only), edges that reference real nodes, `true`/`false` handles only on Condition nodes (and required there), no self-loops, no duplicate edges, at most 50 nodes and 100 edges. Unknown fields are stripped. Drafts may be incomplete: required-config and "exactly one trigger" checks happen at run time.

## Editor (frontend)
- Dashboard: list, create, duplicate and delete workflows.
- Editor at `/workflows/:id`: drag nodes from the palette, connect them, configure the selected node in the right panel. Condition nodes have labelled `true` and `false` outputs.
- Shortcuts: Ctrl+S save, Delete removes the selected node, Ctrl+D duplicates it.
- A validation panel lists problems before a run (no trigger, cycles, unconnected nodes, missing config). Clicking a problem selects the node.
- Run and Stop are disabled until the execution engine exists (Phases 3-5).

## Execution engine (Phase 3)
The engine lives in `backend/src/engine/`. It runs in-process and sequentially. There is no API route yet (Phase 5 adds `POST /api/workflows/:id/execute`), so try it with the CLI runner:
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
6. Every state change is emitted as a SPEC event (`node.started`, `node.skipped`, ...). Phase 5 persists and streams these.

**Expressions**: `{{nodes.<id>.output.<path>}}`, `{{input.<path>}}` (trigger input), and `{{item.<path>}}` (Transform map only). A whole-string expression keeps its type; embedded ones become text. A missing field is empty, but a reference to a node that did not run is an error. The resolver only walks own properties and rejects `__proto__`/`prototype`/`constructor`. There is no eval (`docs/decisions/expressions.md`).

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
cd frontend && npm test    # graph validation and conversion helpers
cd frontend && npm run build
```
The backend tests use an in-memory MongoDB, so they never touch your real database. React components do not have automated tests yet.

## Security notes (so far)
- Passwords hashed with bcrypt (12 rounds); the hash is never returned by the API.
- Login returns the same error for an unknown email and a wrong password.
- helmet, CORS limited to one origin, JSON body size limit, rate limit on auth routes.
- Secrets live only in `.env` files, which are gitignored. AI keys are read only by `backend/src/ai/` and never logged.
- HTTP node SSRF protection (see "HTTP Request and SSRF" above); sensitive response headers are redacted in node outputs.
- No eval anywhere: expressions are path lookups and the AI extract schema is checked by walking it as data.

## Limitations
- The auth token is stored in `localStorage` (see `docs/decisions/auth-storage.md`).
- The engine runs only through the CLI runner and tests until the execute route (Phase 5). The Run button is still disabled.
- Execution is in-process and sequential: no parallel branches, single server instance.
- HTTP node: any port on a public host is reachable; an HTTP status >= 400 fails the node (a Condition cannot branch on a 404); a JSON body built from expressions breaks if a value contains quotes (use a whole-body expression instead).
- Header values typed into a workflow (for example an `Authorization` header) are stored in the workflow as written until the Phase 6 secrets pass.
- Aborting an AI call stops the wait, but the provider may still bill for work already done.
- The "unsaved changes" warning only covers closing or reloading the tab, not clicking a link inside the app.

More sections (nodes, execution flow, deployment, future work) are added as each phase lands.
