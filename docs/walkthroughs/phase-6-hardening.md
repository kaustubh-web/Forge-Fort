# Phase 6: security hardening, secrets vault, deployment

## 1. What was built
- **Abuse limits:**
  - rate limits per IP on auth and on every `/api` route, and per user on starting runs;
  - a cap on concurrent runs per user (`MAX_CONCURRENT_RUNS`) and on open live streams per user (`MAX_STREAMS_PER_USER`).
- **A secrets vault:**
  - users save API keys under Settings, encrypted with AES-256-GCM;
  - an HTTP node uses one as `{{secrets.NAME}}`;
  - the API never returns a value;
  - every stored, streamed or printed piece of a run is scanned for the decrypted values and masked.
- **Hardening from a full security review** (`docs/security-review.md`):
  - HS256 pinned on JWTs;
  - 401 instead of 500 for a bad token subject, and 413 for oversized bodies;
  - the bcrypt 72-*byte* limit;
  - header name and value checks;
  - secrets masked in console output;
  - typed-in credentials refused at save time.
- **Deployment:** a Render Blueprint, Vercel and Netlify SPA rewrites, and `docs/DEPLOYMENT.md`.
- **Extras:**
  - the 11-node trip-weather showcase;
  - a collapsible sidebar;
  - a global Executions page (`GET /api/executions`);
  - the logo.
- **Tests:** backend 305 (Phase 5 had 259), frontend 34.

## 2. Flow map
```
request ─> app.js
  helmet, cors, express.json({ limit: "512kb" })
  GET /api/health                        (before the limiter: health checks never get 429)
  app.use("/api", apiLimiter)            middleware/rateLimit.js createLimiter (per IP, TRUST_PROXY hops)
  /api/auth   authLimiter -> validate(schema/auth.js: password <= 72 UTF-8 bytes) -> authController
  /api/secrets  requireAuth -> secretController -> services/secretService.js
                 createSecret: utils/secretBox.js encrypt(value, `${ownerId}:${name}`) -> Secret (value select:false)
  /api/workflows/:id/execute
     requireAuth (middleware/auth.js: jwt.verify algorithms [HS256], isValidObjectId(sub) else 401)
     -> executeLimiter (key = req.user._id) -> validate(executeSchema) -> executionController.execute
     -> services/executionService.js executeWorkflow(ownerId, workflowId, input)
          getWorkflow (404 if not yours)
          engine/validateForRun.js -> { order, graph, secretNames }   ({{secrets}} outside HTTP -> 400)
          secretService.loadSecrets(ownerId, secretNames) -> decrypt  (missing -> 400 INVALID_WORKFLOW)
          countDocuments({ owner, status: "running" }) >= MAX_CONCURRENT_RUNS -> 429 TOO_MANY_RUNS
          WorkflowExecution.create(...)
          executions/executionRunner.js startExecution({ execution, workflow, input, secrets })
             redact = (v) => hideSecrets(redactDeep(v))  on every event, error, output, log
             engine/runWorkflow.js: context.secrets (expression scope only), context.hideSecrets
                                    (utils/redact.js createValueRedactor) on debug/console lines
                nodes/httpRequest.js: buildHeaders checks the name token and CR/LF/NUL
  /api/executions        GET / -> executionService.listExecutions(ownerId, { status, limit })
  /api/executions/:id/stream -> controllers/streamController.js streamExecution
                              openStreams Map per user, >= MAX_STREAMS_PER_USER -> 429 TOO_MANY_STREAMS
  middleware/errorHandler.js  entity.too.large -> 413 PAYLOAD_TOO_LARGE; exposed 4xx -> BAD_REQUEST_BODY
save-time: nodes/httpRequest.js rejectLiteralSecrets (Zod superRefine on PUT/POST /workflows)

frontend
  pages/Settings.jsx  lib/secretApi.js (list/create/replace/delete; never reads a value back)
  pages/Executions.jsx  lib/executionApi.js listAllExecutions(status) -> row click -> /workflows/:id?run=
  components/AppShell.jsx  collapsible sidebar, components/Logo.jsx
```

## 3. One concrete trace: a secret through a real API that echoes it back
Recorded in Chrome and through the real API (the step 3 and step 6 checks). httpbin.org/headers returns the request headers in its body: the worst case, because the response *contains* the secret.

1. **Settings:** the name is typed as `httpbin_token`, and the form upper-cases it to `HTTPBIN_TOKEN`.
   - The value `fft_demo_<timestamp>` goes in a password field.
   - `POST /api/secrets` stores `v1.<iv>.<tag>.<ciphertext>`, encrypted with the AAD `<ownerId>:HTTPBIN_TOKEN`.
   - The response, and every later `GET /api/secrets`, holds only the name and dates. The check confirmed that no response ever contained the value.
2. **Save a workflow with a typed-in token** (`Authorization: Bearer abc123literal`): **400**. The message is `Header "Authorization" looks like a credential. Save it under Settings > Secrets and use {{secrets.NAME}} here`.
3. **Save the "Secret echo" workflow:** `trigger-1 -> http-1 (GET https://httpbin.org/headers, Authorization: Bearer {{secrets.HTTPBIN_TOKEN}}) -> output-1 ("Server saw: {{nodes.http-1.output.body.headers.Authorization}}")`.
4. **Execute:**
   - `validateForRun` returns `secretNames: ["HTTPBIN_TOKEN"]`.
   - `loadSecrets` decrypts that one secret, and only in memory.
   - The run cap check passes (0 running of 3), the record is created, and the call returns 202.
5. **`http-1`:** the engine resolves the header to `Bearer fft_demo_…` and sends it. httpbin answers 200 with `{"headers": {"Authorization": "Bearer fft_demo_…", ...}}`.
   - The runner's `redact` hides the stored body header in two ways: by key name (`Authorization`) and by value (the token string).
   - Saved and streamed: `body.headers.Authorization: "[REDACTED]"`.
6. **`output-1`:**
   - Its message resolves *in memory* to `Server saw: Bearer fft_demo_…`.
   - The value redactor turns it into `Server saw: Bearer [REDACTED]` before it's saved.
   - `JSON.stringify(execution)` contains the token **0** times. The log panel shows `Bearer [REDACTED]`.
7. **Delete the secret and run again:** **400** `Secret HTTPBIN_TOKEN does not exist. Add it under Settings > Secrets`. No execution record is created.

## 4. See it working
```bash
cd backend && npm test        # 305 tests: rateLimit, secretBox, secrets, secretsRun, bodyErrors, hardening, ...
cd frontend && npm test && npm run build
```
**Rate limit.** In bash, with `TOKEN` and `WF` set:
```bash
for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code} " -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"input":{}}' \
  http://localhost:4000/api/workflows/$WF/execute; done
```
You'll see 202s, then 429s:
- `TOO_MANY_RUNS` while 3 are still running. Use a slow workflow such as Classify; a fast one finishes between requests.
- `RATE_LIMITED` after 30 runs in a minute.

**Secrets:**
1. Open http://localhost:5173/settings, then add `GITHUB_TOKEN`.
2. In an HTTP node, set the URL to `https://api.github.com/user` and add the header `Authorization: Bearer {{secrets.GITHUB_TOKEN}}`.
3. Run it: the log shows your GitHub profile, and the stored request shows `[REDACTED]`.

**Executions page:** sidebar, then **Executions**:
- every run, newest first;
- click **Failed** to filter;
- click a row to jump to that run in its editor.

**Showcase:** run `npm run seed -- you@example.com`, then open **Trip weather advisor** and run it with:
- `{"city": "Mumbai"}` (rain branch);
- `{"city": "Qwxzzy"}` (not-found branch).

**Oversized body:**
```bash
node -e "process.stdout.write(JSON.stringify({input:{x:'a'.repeat(600000)}}))" | curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @- \
  http://localhost:4000/api/workflows/$WF/execute
```
You'll get 413 `PAYLOAD_TOO_LARGE`.

## 5. Break it on purpose
1. **Use a secret in an Output node:** set the message to `{{secrets.GITHUB_TOKEN}}` and run.
   - Result: 400 `Node "output-1": {{secrets...}} can only be used in HTTP Request nodes`, and nothing runs.
   - Why: it would end up in stored outputs or an AI prompt.
2. **Forge a token:** take your JWT, change one character of the payload, and call `/api/auth/me`.
   - Result: 401 `Invalid or expired token`.
   - A token correctly signed with a `sub` that isn't an ObjectId also gets 401, not 500.
3. **Open 11 tabs on one running execution** (or 11 `curl -N .../stream` calls).
   - Result: the 11th gets 429 `TOO_MANY_STREAMS`.
   - Closing one frees a slot, because `close()` decrements the count exactly once.
4. **Header injection:** put `{{input.h}}` in a header value and run with `{"h": "a\r\nX-Evil: 1"}`.
   - Result: the node fails **once**, with a message about the line break. It isn't retried and no request is sent.
5. **Lose the key:** change `SECRETS_KEY` in `backend/.env` and restart.
   - Result: executing a workflow that uses a secret returns a generic 500, and nothing runs.
   - The server console shows `Unsupported state or unable to authenticate data`: GCM's tag check refuses the wrong key instead of returning garbage.
   - Back up the key (`docs/DEPLOYMENT.md`), then restore the original.

## 6. Interview questions
1. **Why AES-256-GCM and not CBC?** GCM is *authenticated*. The tag detects any change to the ciphertext, IV or AAD, so a tampered or swapped value fails to decrypt instead of producing garbage. CBC needs a separate HMAC and padding-oracle care. GCM's one rule is to never reuse an IV with the same key, so every encrypt uses a fresh random 12-byte IV.
2. **What does the AAD `ownerId:NAME` protect against?** Someone with database write access copying user A's encrypted `STRIPE_KEY` into user B's record, or renaming it. The AAD is part of the tag, so decryption fails unless the owner and name match.
3. **Why rate-limit execute per user but auth per IP?**
   - Before login there is no user, so IP is the only key.
   - Execute runs after `requireAuth`, so it is keyed on the account. Switching IPs doesn't help an attacker, and people behind one office NAT don't block each other.
   - `TRUST_PROXY` is a hop count, never `true`, so a client can't fake `X-Forwarded-For`.
4. **Why mask secrets by value as well as by key name?** Key names only catch fields called `authorization` or `token`. A secret inside a URL (`?key=...`), echoed in a response body, or quoted in an error message would slip through. The engine knows the exact decrypted strings, so it replaces them anywhere, including their URL-encoded form.
5. **What is the race in the concurrent-run cap, and how would you fix it?** It counts running records, then inserts. Two requests in the same millisecond can both see 2 of 3 and both insert. The fix is an atomic per-user counter (`findOneAndUpdate` with `$inc` and a `$lt` condition) or a queue. That was accepted for one instance and documented.

## 7. Glossary
- **AES-256-GCM:** a symmetric cipher mode that encrypts and authenticates in one step, with a 32-byte key, a 12-byte IV and a 16-byte tag.
- **IV (nonce):** a random value per encryption, so the same plaintext never encrypts the same way twice.
- **AAD:** additional authenticated data. It isn't encrypted, but it's bound into the tag, so it must match on decrypt.
- **Value redaction:** replacing known secret strings anywhere in output, regardless of the field name.
- **Rate limit (fixed window):** count requests per key in a time window, then refuse with 429 until the window resets.
- **Trust proxy:** how many proxy hops Express believes when it reads the client IP from `X-Forwarded-For`.
- **Algorithm pinning:** telling the JWT verifier which algorithm to accept, instead of trusting the token's own header.
- **413 Payload Too Large:** the status for a request body over the server's limit.
- **Blueprint (`render.yaml`):** infrastructure-as-code for Render: the service, its build and start commands, the health check and its env vars.
- **SPA rewrite:** the static host serves `index.html` for every path, so client-side routes such as `/workflows/:id` survive a refresh.
