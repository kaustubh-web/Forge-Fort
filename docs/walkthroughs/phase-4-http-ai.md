# Phase 4: HTTP and AI nodes, retries, timeouts, cancellation

## 1. What was built
- An HTTP client that can only reach public addresses (SSRF protection): DNS is checked, the socket connects to exactly the checked IP, every redirect is re-checked, the body is capped at 1 MB.
- The HTTP Request node on top of it. Each failure is classified as worth retrying (429/502/503/504, network) or not (404, blocked URL, bad JSON body).
- The AI Text node with four modes and two providers (Gemini, OpenAI) behind one small interface. Replies are validated, and a bad reply is re-asked with the exact problem.
- Engine upgrades in `executeNode`: retries with exponential backoff for transient errors only, a timeout per attempt, a 5-minute deadline per workflow, and a real mid-call Stop through `AbortSignal`.
- Three example workflows (SPEC section 12), Ctrl+C cancel in the CLI, and two decision notes (`ssrf.md`, `ai-provider.md`).
- Tests: 221 backend tests (92 before + 129 new). No test touches the real internet or a real AI.

## 2. Flow map
```
scripts/run-workflow.js   (Ctrl+C -> controller.abort())       Phase 5: POST /execute, POST /cancel
 -> engine/runWorkflow.js  runWorkflow({ workflow, input, signal, limits })
      deadline  = AbortSignal.timeout(WORKFLOW_TIMEOUT_MS)
      runSignal = AbortSignal.any([signal, deadline]);  stopError() -> CancelledError | WorkflowTimeoutError
    loop: runSignal.aborted? -> skip the rest ("execution cancelled" / "workflow timed out")
    -> executeNode(node, record, context, { runSignal, stopError, nodeTimeoutMs })
         resolveConfig()                                   (once, so every attempt sends the same thing)
         policy = config.retry ?? definition.defaultRetry ?? NO_RETRY
         for attempt = 1..maxAttempts:
           runAttempt(): signal = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)])
                         engine/retry.js raceAbort(definition.execute({ config, signal, ... }), signal)
                         aborted? -> stopError() or NodeError("Timed out after N ms", retryable)
           NodeError.retryable? -> attemptLog.push, retry.js backoffDelay(), sleep(waitMs, runSignal)
         -> nodes/httpRequest.js  execute = createHttpRequestHandler(safeFetch)
              buildUrl / buildHeaders / buildBody
              net/safeFetch.js  safeFetch(url, { signal, maxBytes, maxRedirects })
                checkUrl()        http/https only, IP literals via net/ipPolicy.js isPublicAddress()
                undici fetch(..., { redirect: "manual", dispatcher: Agent({ connect: { lookup: guardedLookup } }) })
                guardedLookup()   dns.lookup(all) -> every IP must pass isPublicAddress -> socket uses those IPs
                3xx -> new URL, drop credentials if cross-origin, loop (max 5)
                readLimited()     Content-Length check, then count bytes, abort past 1 MB
              status >= 400 -> NodeError(retryable for 429/502/503/504, retryAfterMs)
              output { status, headers: utils/redact.js redactHeaders(), body: JSON or text }
         -> nodes/aiText.js  execute = createAiTextHandler(getAiProvider)
              ai/provider.js   getAiProvider() -> ai/gemini.js | ai/openai.js  complete({ model, system, prompt, json, signal })
              ai/errors.js     toAiNodeError(): 429/5xx/network retryable, 401/403 key error, other 4xx final
              MODES[mode].check(raw) -> { output } | { problem } -> re-ask (AI_OUTPUT_RETRIES) -> NodeError
              ai/jsonShape.js  validateShape() for extract; checkSchema() via definition.checkConfig in validateForRun
```

## 3. One concrete trace: Workflow 2, `examples/http-condition.json`, input `{ "todoId": 1 }`
Real run on 2026-10-29: COMPLETED in 644 ms.
1. **trigger-1** outputs `{ todoId: 1 }`. Edge `e1` becomes active.
2. **http-1**: `resolveConfig` turns the URL into `https://jsonplaceholder.typicode.com/todos/1`. Policy: config says 3 attempts / 500 ms; `timeoutMs` 10000. Attempt 1 gets a signal that fires after 10 s or on Stop.
   - `checkUrl`: https, hostname is not an IP literal, so it is fine.
   - undici opens a socket and asks `guardedLookup("jsonplaceholder.typicode.com")`. DNS returns public Cloudflare addresses, all pass `isPublicAddress`, and the socket connects to one of them.
   - 200, 83 bytes (well under 1 MB). The body parses as JSON. Output: `{ status: 200, headers: {...}, body: { userId: 1, id: 1, title: "delectus aut autem", completed: false } }`. `attempts: 1`, `attemptLog: []`, 638 ms.
3. **check-1**: `{{nodes.http-1.output.body.completed}}` is a whole-string expression, so it stays the boolean `false`. `compare(false, "equals", "true")` compares as text: `"false" !== "true"`, so it takes the **false** branch. `e3` (true) becomes inactive and `e4` (false) becomes active.
4. **done-1** is skipped: "Condition 'check-1' took the false branch". `e5` becomes inactive.
5. **pending-1** runs: logs "Todo 1 is still open: delectus aut autem". `e6` becomes active.
6. **output-1**: `e5` is inactive and `e6` is active, so it runs (converging-inputs rule): "Checked todo 1 (HTTP 200): completed = false".

With `'{"todoId":4}'` (a completed todo) the branches swap: done-1 runs and pending-1 is skipped.

## 4. See it working
```powershell
cd backend
npm test                                                          # 221 passed
npm run engine:run -- examples/http-condition.json                # false branch (todo 1)
npm run engine:run -- examples/http-condition.json '{\"todoId\":4}'  # true branch
$env:DEBUG_ENGINE="true"; npm run engine:run -- examples/http-condition.json; Remove-Item Env:DEBUG_ENGINE
```
AI workflows: add to `backend/.env`:
```
AI_PROVIDER=gemini           # or openai
GEMINI_API_KEY=...           # or OPENAI_API_KEY=...
AI_MODEL=<a model id from the provider's model list>
```
then `npm run engine:run -- examples/ai-summarize.json` (Workflow 1) and `npm run engine:run -- examples/http-ai.json` (Workflow 3). Without a key, both fail cleanly at the AI node with "AI provider not configured", and the HTTP part of Workflow 3 still succeeds.

## 5. Break it on purpose
Copy `examples/http-condition.json` to a scratch file and change `http-1`'s config. Run with `DEBUG_ENGINE=true` to see retries.
1. **Cloud metadata**: `"url": "http://169.254.169.254/latest/meta-data"`. Expected: `Blocked: 169.254.169.254 is not a public address`, after about 5 ms. No request leaves the machine.
2. **Your own API**: `"url": "http://localhost:4000/api/health"`. Expected: `Blocked: localhost resolves to a non-public address (::1)`. This is caught by DNS (`guardedLookup`), not by the URL text.
3. **Transient failure**: `"url": "https://httpbin.org/status/503", "retry": { "maxAttempts": 3, "backoffMs": 500 }`. Expected debug lines: `attempt 1 failed (HTTP 503 ...), retrying in 500 ms`, then `... in 1000 ms`, then FAILED after about 3.5 s. Change it to `/status/404`: one attempt only, because a 404 is not retryable.
4. **Timeout**: `"url": "https://httpbin.org/delay/10", "timeoutMs": 2000, "retry": { "maxAttempts": 2, "backoffMs": 200 }`. Expected: `Timed out after 2000 ms` twice, FAILED after about 4.2 s.
5. **Cancel mid-run**: run experiment 4 and press Ctrl+C during the wait. Expected: `Cancelling...`, http-1 `failed: Cancelled`, the rest `skipped: execution cancelled`, status CANCELLED, returned at once (the socket is closed, not waited out).

(Redirect to a private IP: public redirectors such as httpbin now refuse internal targets themselves, so this is shown by the `safeFetch` tests "blocks a redirect to a private hostname" and "...to the cloud metadata address".)

## 6. Likely interview questions
1. **How does your SSRF protection handle DNS rebinding?** We do not check a hostname and then let the HTTP client resolve it again. Our own `lookup` function runs inside socket creation: it resolves the name, rejects if any address is not public, and gives the socket exactly those addresses. There is no second lookup to race.
2. **Why an allow-list of "unicast" instead of blocking private ranges?** A block-list fails open: forget one range (CGNAT, NAT64, IPv4-mapped IPv6) and it is reachable. With an allow-list, anything unusual is blocked by default. IP parsing is left to ipaddr.js because odd formats like `::ffff:7f00:1` are where hand-written checks break.
3. **Which errors do you retry, and why not all of them?** Only errors marked `retryable`: network errors, timeouts, 429/502/503/504, AI rate limits and 5xx. A 404, a blocked URL or a bad schema gives the same result every time, so retrying only wastes time and quota. The backoff doubles each time so an overloaded server can recover, and it respects `Retry-After`.
4. **How does Stop actually stop an HTTP call?** Each attempt gets an `AbortSignal` that combines the Stop signal, the workflow deadline and the node timeout (`AbortSignal.any`). The handler passes it into `fetch` or the AI SDK, which closes the connection. The engine also races the handler against the signal, so even a handler that ignored it could not hang the run. Backoff sleeps listen to the same signal.
5. **How do you deal with an LLM returning the wrong format?** JSON mode first, then our own checks: valid JSON, a category from the list, data matching the user's schema. On a failure we ask again and say exactly what was wrong, at most twice more. That loop is separate from the engine's retries, which are for failed calls, not bad answers. We did not use ajv because it compiles user-supplied schemas into code with `new Function`.

## 7. Glossary
- **SSRF**: making a server send requests to places the attacker cannot reach directly (internal services, cloud metadata).
- **DNS rebinding**: a hostname that resolves to a public IP when checked and a private IP when connected.
- **Cloud metadata endpoint**: `169.254.169.254` (and IPv6 `fd00:ec2::254`), where cloud VMs get their credentials.
- **IPv4-mapped IPv6**: `::ffff:a.b.c.d`, an IPv4 address written as IPv6.
- **undici Agent / dispatcher**: the connection pool behind `fetch`; ours replaces DNS lookup for every socket.
- **Transient error**: a failure that may succeed if tried again later (rate limit, overload, dropped connection).
- **Exponential backoff**: waiting 1 s, 2 s, 4 s... between retries.
- **Retry-After**: a response header in which the server says how long to wait.
- **AbortSignal.any / AbortSignal.timeout**: build one signal that fires when any of several fire / after a delay.
- **JSON mode**: a provider setting that forces the model to reply with JSON only.
- **Prompt injection**: text inside the data that tries to give the model new instructions.
