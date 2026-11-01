# ForgeFort: Agentic Workflow Automation Platform

A visual workflow builder (React Flow) with a custom Node.js execution engine. Users connect nodes on a canvas, run workflows on the backend, and inspect persisted results.

Read before planning or coding:
- @docs/SPEC.md : what to build (v1 scope, nodes, engine rules, API, models, tests, phases)
- @docs/ARCHITECTURE.md : how execution works (read before touching the engine)
- @docs/DESIGN.md : UI design system (read before touching the frontend)

## About me and how to work with me
- I am a CS student building this as a portfolio project. I must understand and be able to explain every part in interviews.
- Prefer simple, readable code over clever code. Comment the key decisions in the engine.
- Keep chat replies short. Do not paste whole files into chat. Summarize what changed.
- Default model is Sonnet. If a task needs deeper reasoning (engine design), say so and I will switch.

## Role
Act as a senior full-stack engineer and software architect. Build real functionality: real execution, real API calls, real persistence, validation, error handling. No mock UIs, no fake executors.

## Stack
- Frontend: React + Vite, JavaScript, Tailwind CSS, shadcn/ui, @xyflow/react, Axios, React Router
- Backend: Node.js, Express, MongoDB Atlas + Mongoose, REST
- AI: official Gemini or OpenAI SDK, provider chosen by env vars
- ES modules everywhere. Separate /frontend and /backend directories.
- All secrets in env vars, validated at startup. Never expose keys to the frontend.

## Scope
Build ONLY v1: Manual Trigger, HTTP Request, AI Text Processing, Condition, Transform Data, Log/Output, with JWT auth.
Out of scope (design so they can be added later, do NOT implement): Delay, Manual Approval, AI Agent, parallel execution, multi-instance scaling.

## Non-negotiables
- Never trust incoming workflow JSON. Validate on the server (Zod or Joi).
- Never use eval, Function, or run user-supplied code. Expressions use a safe path resolver only.
- SSRF protection on the HTTP node (see SPEC).
- Redact secrets (auth headers, API keys, tokens) in logs and stored executions.
- Every route enforces auth and ownership.
- Do not claim a feature works until it is implemented, tested, and actually run.

## Working rules
1. First inspect the workspace. If empty, initialize. Start with a short plan and folder structure. Wait for my approval before coding.
2. Work one phase at a time (phases are in SPEC). Do not start the next phase until the current one passes the checklist below and I confirm.
3. Keep the app runnable at all times. One commit per feature with a clear message.
4. Keep this file's "Commands" section up to date as scripts are added.

## Research before building (unfamiliar features)
For unfamiliar or non-trivial features (SSRF, safe expressions, SSE reconnect, React Flow patterns, cancellation), do not implement from scratch right away:
1. Look at 2-3 similar open-source projects or libraries that are actively maintained (activity in the last 12 months) and clearly licensed.
2. Compare approach, dependencies, test coverage, and known issues.
3. Licenses: MIT, Apache-2.0, BSD, ISC may be used as dependencies or adapted with attribution. GPL/AGPL, source-available or "fair-code" licenses (for example n8n's), unknown licenses, or no license: study the design only, never copy code. Verify the current license in the repo itself.
4. Never paste code from sources with unclear provenance.
5. Prefer a vetted dependency over reimplementing security-sensitive logic, after checking it is maintained and has no open advisories.
6. Write a short note in docs/decisions/<feature>.md: options considered (links, licenses), choice and why, what was borrowed, risks.
7. If you cannot browse or verify a license, say so and ask me. Do not guess.

## After every feature or phase (mandatory checklist)
1. Run the full test suite and the frontend build. Fix all failures.
2. Run the 3 example workflows end-to-end through the real API. Report pass/fail for each.
3. Verify: save workflow in UI, execute, live SSE updates, persisted execution visible after page refresh.
4. Verify the new feature: happy path, invalid input, failure and retry, cancellation (if it makes network or AI calls), auth and ownership (if it adds a route).
5. Add or update tests. No feature is done without tests.
6. Update the README (nodes, API docs, execution flow, limitations) and seed workflows if affected.
7. Write the walkthrough (next section).
8. Reply with a short status report: what was added, files changed, test counts, example workflow results, known issues.

## Teach me as you build (mandatory)
After each phase, before asking me to move on, create `docs/walkthroughs/phase-N-<name>.md` with:
1. What was built, in plain English (max 10 lines).
2. Flow map using real file paths and function names (for example route -> controller -> service -> engine -> node handler -> DB).
3. One concrete trace with real data (for example Workflow 2 step by step: node order, each node's input and output, which branch was skipped and why).
4. "See it working": exact commands, URLs, curl examples or UI clicks, and what I should see.
5. "Break it on purpose": 3-5 experiments (invalid graph, cycle, failing HTTP call, cancel mid-run, SSRF URL) with the expected result.
6. Five likely interview questions about this phase with short answers.
7. Glossary of new concepts, one line each.

Build explainability into the product itself:
- The execution log shows node order, timings, retry attempts, and a human-readable skip reason (for example "Skipped: Condition 'check-1' took the false branch").
- Engine debug logging behind `DEBUG_ENGINE=true` (prints order, edge states, decisions).
- When I say "quiz me", ask 5 questions about the phase just built and wait for my answers.

## Commands
(Keep updated as scripts are added.)
- Backend (from `backend/`): `npm run dev` (watch mode) or `npm start`, serves on port 4000. Needs `backend/.env` (copy `.env.example`). Watch mode restarts on every backend save, which marks running executions `failed` ("server restarted").
- Frontend (from `frontend/`): `npm run dev` (port 5173, strict), `npm run build`, `npm test` (Vitest, helper modules only). Needs `frontend/.env`.
- Tests (from `backend/`): `npm test` (Vitest + supertest + mongodb-memory-server; no real DB needed).
- Run a workflow file through the engine (from `backend/`): `npm run engine:run -- examples/diamond.json [input.json | 'json']`. Set `DEBUG_ENGINE=true` for engine debug logs. Ctrl+C cancels the run. Examples: `diamond`, `pipeline` (offline), `http-condition` (internet), `ai-summarize`, `http-ai` (need `AI_PROVIDER`, its key and `AI_MODEL`).
- Seed example workflows (from `backend/`): `npm run seed -- you@example.com` adds the 3 SPEC examples plus the trip-weather showcase to an existing account (re-running updates them, no duplicates).
