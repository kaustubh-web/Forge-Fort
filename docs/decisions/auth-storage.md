# Decision: auth token storage and password hashing

## Context
SPEC section 2 requires JWT auth with the token sent in the `Authorization` header. The frontend must keep the token across page refreshes.

## Options considered: where the frontend keeps the token
| Option | Pros | Cons |
|---|---|---|
| `localStorage` + `Authorization: Bearer` (chosen) | Matches the SPEC; simple; works with Axios and with a fetch-based SSE reader in Phase 5 | Readable by any script on the page, so an XSS bug could steal the token |
| httpOnly cookie | JavaScript cannot read it, which is safer against XSS | Contradicts the SPEC's header requirement; needs CSRF protection; native `EventSource` would work but the design would change |
| In-memory only | Safest against XSS | Lost on refresh, which breaks "refresh-safe" behaviour |

## Choice
`localStorage` with a Bearer header. Mitigations: React escapes output by default, we render no user HTML, tokens expire (`JWT_EXPIRES_IN`, default 7d), and on any 401 the client deletes the token and logs out.

## Options considered: password hashing
- `bcryptjs` (chosen): MIT license, pure JavaScript, no native build step (avoids Windows toolchain problems), widely used. Slower than native bcrypt, which is acceptable at this scale.
- `argon2`: stronger and newer, but needs native compilation.
- Cost factor 12, and passwords are limited to 72 characters because bcrypt ignores bytes past 72.

## What was borrowed
Nothing copied. Both libraries are used as normal dependencies.

## Risks
- XSS would expose the token. Revisit with httpOnly cookies plus CSRF protection if this ever goes to production.
- Tokens cannot be revoked before they expire (no server-side session list). Acceptable for v1.
