# Forge-fort

A visual workflow builder (React Flow) with a custom Node.js execution engine. Users connect nodes on a canvas, run workflows on the backend, and inspect persisted results.

> Status: Phase 1 (setup and auth) complete. Editor, engine, nodes and live updates arrive in Phases 2-6. See `docs/SPEC.md` for scope and `docs/ARCHITECTURE.md` for how execution will work.

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

## Tests
```bash
cd backend && npm test     # API tests, in-memory MongoDB
cd frontend && npm test    # graph validation and conversion helpers
cd frontend && npm run build
```
The backend tests use an in-memory MongoDB, so they never touch your real database. React components do not have automated tests yet.

## Security notes (so far)
- Passwords hashed with bcrypt (12 rounds); the hash is never returned by the API.
- Login returns the same error for an unknown email and a wrong password.
- helmet, CORS limited to one origin, JSON body size limit, rate limit on auth routes.
- Secrets live only in `.env` files, which are gitignored.

## Limitations
- The auth token is stored in `localStorage` (see `docs/decisions/auth-storage.md`).
- Workflows can be built, saved and loaded, but not run yet (no engine until Phase 3).
- The "unsaved changes" warning only covers closing or reloading the tab, not clicking a link inside the app.

More sections (nodes, execution flow, deployment, future work) are added as each phase lands.
