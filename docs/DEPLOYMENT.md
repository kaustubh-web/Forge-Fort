# Deploying ForgeFort

```
Browser ── HTTPS ──> Vercel (static frontend: frontend/dist)
   │
   └──── HTTPS + Bearer token ──> Render web service (backend, ONE instance)
                                    ├──> MongoDB Atlas (data)
                                    └──> public APIs / Gemini (HTTP and AI nodes, SSRF-checked)
```
The frontend is plain static files; the browser calls the API directly (CORS allows exactly one origin). The backend must run as **a single instance**: running executions, their cancel controllers, live-update streams and rate-limit counters all live in its memory (README "Limitations").

Facts below were checked against the providers' docs on 2026-11-01. Free-tier details change, so re-check before relying on them.

## 1. MongoDB Atlas
1. Create a cluster (the free M0 is enough).
2. **Database user, least privilege.** Under Database Access, add a user with a long generated password and, instead of the default "read and write to any database", **Specific Privileges: `readWrite` on `forgefort`** only. A leaked connection string then can't touch other databases on the cluster.
3. **Network access.**
   - **Best:** allow only Render's outbound IP ranges. In Render, open the service, then **Connect → Outbound**. The ranges are shared by all services in the same region.
   - **Fallback:** `0.0.0.0/0`. Atlas then relies on the username and password alone, so use a long random password, and switch to the ranges as soon as you can.
   - To run the seed script from your laptop, add your own IP as a **temporary** entry (Atlas can expire it automatically, up to 7 days).
4. Connection string, with the database name in the path:
   `mongodb+srv://<user>:<password>@<cluster-host>/forgefort?retryWrites=true&w=majority`

## 2. Generate production secrets (on your machine)
Never reuse the development values.
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SECRETS_KEY (exactly 64 hex chars)
```
Put both in a password manager. **If `SECRETS_KEY` is lost, every saved secret becomes unreadable** and users must enter them again. Changing `JWT_SECRET` logs everyone out, which is harmless.

## 3. Backend on Render
**With the Blueprint (`render.yaml` in the repo root):** Render dashboard, then **New → Blueprint**, then pick the repo. It creates `forge-fort-api` from `backend/` with `npm ci` / `npm start`, the health check at `/api/health`, `NODE_ENV=production` and `TRUST_PROXY=1`. It asks once for the values marked `sync: false`:

| Variable | Value |
|---|---|
| `MONGODB_URI` | the Atlas string from step 1 |
| `JWT_SECRET`, `SECRETS_KEY` | from step 2 |
| `CORS_ORIGIN` | the Vercel URL from step 4, for example `https://forge-fort.vercel.app` (no trailing slash). Put a placeholder first and fix it after step 4. |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_MODEL` | `gemini`, your key, a model id from the provider's list. Leave `AI_PROVIDER` empty to run without AI nodes. |

**Without the Blueprint:** create a Web Service with Root Directory `backend`, Build `npm ci`, Start `npm start`, Health Check Path `/api/health`, and the same variables.

Other limits keep their defaults (`.env.example`); set them only to change them. The server checks every variable at startup and **refuses to boot** with a list of what's wrong. Read the deploy log if it doesn't come up.

Check it: `curl https://<service>.onrender.com/api/health` should return `{"success":true,"data":{"status":"ok"}}`.

**Free plan behaviour (what it means for this app):**
- The service sleeps after **15 minutes** without traffic, and the next request wakes it in **about a minute**. The first page load after a pause is slow; the frontend shows its loading state meanwhile.
- **750 free instance hours per month** per workspace.
- **Every restart (deploy, wake-up after sleep, crash) ends any run in progress.** On boot, those runs are marked `failed` with "server restarted". Runs last at most 5 minutes (`WORKFLOW_TIMEOUT_MS`), so this mostly matters during deploys.
- Never scale above one instance (see the top of this page).

## 4. Frontend on Vercel
1. **New Project**, import the repo, set **Root Directory: `frontend`**. Vercel detects Vite: build `npm run build`, output `dist`.
2. Environment variable: `VITE_API_URL=https://<service>.onrender.com/api`.
   - Vite bakes it in **at build time**, so **redeploy** after changing it.
   - It's public by design: it's only a URL. Never put a key in a `VITE_` variable.
3. Deep links such as `/workflows/<id>?run=<id>` work because `frontend/vercel.json` rewrites every path to `index.html`, where React Router takes over. On Netlify, `frontend/public/_redirects` does the same.
4. Go back to Render and set `CORS_ORIGIN` to this production URL. Render restarts the service.
   - Vercel preview deployments get other URLs, and CORS will reject them. That's intended: only one origin is allowed.

## 5. First run (smoke test)
1. Open the Vercel URL, **register**, and log in.
2. Load the example workflows. From `backend/` on your machine, with your IP temporarily allowed in Atlas:
   ```bash
   MONGODB_URI="<production string>" npm run seed -- you@example.com
   ```
   (PowerShell: `$env:MONGODB_URI="<production string>"; npm run seed -- you@example.com`.)
   - dotenv never overrides a variable that's already set, so this one value points the script at production, and the rest still comes from your local `.env`.
   - The seed only writes workflows. It doesn't use the JWT or secrets keys.
3. Run **Todo status check** with `{"todoId": 4}`. The nodes colour live, then refresh: the run comes back. Run **Classify an API post** with `{"postId": 3}` (needs the AI variables) and press **Stop** once to see cancellation.
4. Settings, then add a secret, and use it in an HTTP node: the log shows `[REDACTED]`.

## 6. Environment checklist (production)
| Backend variable | Production value | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `TRUST_PROXY` | `1` | Render's proxy is one hop away. Without it, every user shares the proxy's IP in rate limits. Never `true`: clients could fake their IP. |
| `MONGODB_URI` | Atlas, least-privilege user | |
| `JWT_SECRET` | 96 hex chars, new | |
| `SECRETS_KEY` | 64 hex chars, new, **backed up** | |
| `CORS_ORIGIN` | the exact Vercel URL | one origin, no wildcard |
| `AI_PROVIDER` / key / `AI_MODEL` | optional | keys stay on the server |
| everything else | defaults | rate limits, run/stream caps, timeouts, HTTP limits |

| Frontend variable | Value |
|---|---|
| `VITE_API_URL` | `https://<service>.onrender.com/api` |

## 7. Operating it
- **Logs:** the Render dashboard. Unexpected errors print stacks there, with secret values already replaced by `[REDACTED]`.
- **Backups:** M0 clusters have no automatic backups. Export with `mongodump` if the data matters.
- **Updating:** pushing to `main` redeploys both services. Ongoing runs on the backend end with "server restarted".
- **Alternatives:** Railway (backend, always-on paid plan, no sleeping) and Netlify (frontend, `_redirects` included) work with the same settings. Any host is fine as long as it runs **one** long-lived Node process (not serverless functions: runs and SSE streams need a process that stays up).
