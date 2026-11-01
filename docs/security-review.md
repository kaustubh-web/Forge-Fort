# Security review (Phase 6)

A pass over the whole codebase against the CLAUDE.md non-negotiables and common web risks. Each area lists what was checked and what was found. "Fixed" items have a test in `backend/tests/` that fails without the fix (checked by removing the fix and re-running).

## Findings fixed in Phase 6
| # | Finding | Impact | Fix | Test |
|---|---|---|---|---|
| 1 | JWT algorithm not pinned | A token's header chose how it was verified (`jsonwebtoken` v9 already refuses `none`, but relying on library defaults is fragile) | `HS256` named on sign and verify | `auth.test.js` "token hardening" |
| 2 | A correctly signed token with a non-ObjectId `sub` gave **500** | A crash path reachable from outside; noisy logs | Check `isValidObjectId` before the lookup; 401 | same |
| 3 | Oversized JSON body (and other body-parser errors) gave **500** | Wrong status; real errors hidden in logs | 413 `PAYLOAD_TOO_LARGE`, 4xx for other client body errors | `bodyErrors.test.js` |
| 4 | Unlimited open SSE streams per user | One account could hold thousands of sockets, listeners and timers | `MAX_STREAMS_PER_USER` (10), 429 | `stream.test.js` |
| 5 | **Secrets in server console output**: debug lines and unexpected-error stacks could quote a resolved URL with `?key=<secret>` | Secrets in log files and log services | Same value redactor as storage, applied to console output | `hardening.test.js` |
| 6 | Password limit was 72 **characters**, bcrypt uses 72 **bytes** | Accented/non-Latin passwords silently truncated; two long passwords sharing 72 bytes would both log in | Limit by UTF-8 byte length | `hardening.test.js` |
| 7 | Header value with a line break (e.g. from an expression) | No injection (fetch refuses it), but it was treated as a network error and retried 3 times with a confusing message | Validate header names (RFC 9110 token) and values (no CR/LF/NUL), fail once | `hardening.test.js` |
| 8 | No rate limit on starting runs, no cap on concurrent runs | Cost and resource exhaustion through HTTP/AI calls | Per-user execute limit, `MAX_CONCURRENT_RUNS` | `rateLimit.test.js`, `executions.test.js` |
| 9 | Plaintext credentials in workflow JSON | DB exposure leaks third-party keys | Encrypted secrets vault, literal credentials refused | `secrets*.test.js`, `secretBox.test.js` |
| 10 | `shadcn` CLI listed as a runtime dependency | Production audit showed its advisories | Moved to devDependencies (pinned 4.22.1); `npm audit --omit=dev`: 0 | n/a |

## Checked, no change needed
- **Auth on every route.** Every router except `/api/auth/register|login` and `/api/health` runs `requireAuth`. Every query filters by `owner`, and another user's ids give 404 (`*.test.js` ownership tests).
- **Login.** Same error for unknown email and wrong password. A dummy bcrypt hash is compared when the user doesn't exist, so response time doesn't reveal which emails are registered. Rate limited per IP.
- **Register says "email exists" (409).** This reveals that an account exists. That's accepted for a portfolio app: login doesn't leak it, registration is rate limited, and hiding it would need email verification.
- **No code execution.** No `eval`, `Function`, `vm` or dynamic `RegExp` anywhere. Expressions are dotted path lookups that block `__proto__` / `prototype` / `constructor`. The AI extract schema is checked by walking it as data (no ajv code generation).
- **ReDoS.** All regexes are simple and anchored with no nested quantifiers. Condition `contains` uses `includes`, not a regex.
- **NoSQL injection.** Request bodies are parsed by Zod into known types before any query. Route params are strings used as values, never as query objects.
- **SSRF.** Covered in Phase 4 (`docs/decisions/ssrf.md`): DNS pinning, every redirect re-checked, private, link-local and metadata ranges blocked, 1 MB cap.
- **XSS.** React escapes everything. There is no `dangerouslySetInnerHTML` and no `href` built from data. JSON is shown in `<pre>{text}</pre>`.
- **Secrets at rest and in transit.** See `docs/decisions/secrets.md`. Key-name and value redaction are applied before storage and streaming.
- **CORS and headers.** CORS allows one configured origin; there are no cookies, so no CSRF surface. helmet defaults. 512 KB body limit.
- **Error responses.** Unexpected errors return a generic 500 message. Stacks only go to the server console, where secret values are now redacted.

## Known, accepted risks (README "Limitations")
- The JWT is stored in `localStorage` (`docs/decisions/auth-storage.md`). Any XSS could read it; React's escaping and the absence of HTML sinks are the mitigation.
- Rate limits, run caps and stream caps are in process memory (single instance).
- `SECRETS_KEY` lives next to the app: this protects against database exposure, not a compromised server.
- Dev-only advisories remain in the `shadcn` CLI's dependency tree (`deepmerge`, `minimatch`). The CLI only runs locally to add components and never ships.
