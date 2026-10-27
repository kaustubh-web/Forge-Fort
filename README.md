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

## API (Phase 1)
All responses use `{ success: true, data }` or `{ success: false, error: { code, message, details } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | no | Liveness check |
| POST | `/api/auth/register` | no | `{ email, password }` (password 8-72 chars). 201 with `{ user, token }`. 409 if the email exists. |
| POST | `/api/auth/login` | no | `{ email, password }`. 200 with `{ user, token }`. 401 for any bad credentials. |
| GET | `/api/auth/me` | Bearer token | Current user |

Send the token as `Authorization: Bearer <token>`.

## Tests
```bash
cd backend && npm test
```
Uses an in-memory MongoDB, so it never touches your real database.

## Security notes (so far)
- Passwords hashed with bcrypt (12 rounds); the hash is never returned by the API.
- Login returns the same error for an unknown email and a wrong password.
- helmet, CORS limited to one origin, JSON body size limit, rate limit on auth routes.
- Secrets live only in `.env` files, which are gitignored.

## Limitations
- The auth token is stored in `localStorage` (see `docs/decisions/auth-storage.md`).
- No workflow features yet.

More sections (nodes, execution flow, deployment, future work) are added as each phase lands.
