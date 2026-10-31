# Decision: storing secrets for workflows (API keys, tokens)

## Problem
An HTTP node that calls an authenticated API needs a key or token. Until now it was typed into the node's headers and saved in the workflow JSON as plain text. SPEC section 9: "Never store plaintext secrets in workflow JSON or logs."

That leaves three questions:
1. Where does the value live?
2. How is it protected at rest?
3. How does it reach the HTTP call without leaking into stored executions, the SSE stream or the browser?

## How others do it (studied, nothing copied)
| Project | License (checked in repo) | How credentials are stored | Notes |
|---|---|---|---|
| [Node-RED](https://github.com/node-red/node-red), `runtime/lib/nodes/credentials.js` | Apache-2.0 | Separate credentials file, `aes-256-ctr`, a random 16-byte IV per encryption stored as a hex prefix. Key = `sha256(credentialSecret)`. | The secret lives outside the flow JSON, which is the same idea as ours. CTR has **no integrity check**: a modified ciphertext decrypts to garbage instead of failing. The key comes from a single unsalted SHA-256. |
| [Activepieces](https://github.com/activepieces/activepieces), `server/api/src/app/helper/encryption.ts` | MIT (except `packages/ee`) | Connections encrypted with `aes-256-cbc`, a random 16-byte IV, stored as `{ iv, data }` in hex. Key from an env secret. | CBC is also unauthenticated (malleable, padding-oracle risks if errors leak). The idea of storing the IV next to the ciphertext and keeping the key in env is the same as ours. |
| n8n | "Sustainable Use" (fair-code) | Not studied in code; license excluded. | Design only per CLAUDE.md, and nothing used. |

Both studied projects are actively maintained and keep the key in configuration, not in the database. Neither uses an authenticated mode, and that is the one thing we do differently.

## Choice
**AES-256-GCM from `node:crypto`. No new dependency.**
- **Authenticated encryption.** GCM produces a 16-byte tag. Decryption fails loudly if the ciphertext, IV or tag was changed. That rules out silent tampering, which CTR and CBC alone allow.
- **Key:** `SECRETS_KEY`, exactly 32 random bytes written as 64 hex characters, validated at startup. It's used directly as the AES key, not derived from a password, so no KDF is needed. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **IV:** 12 random bytes per encryption, the recommended GCM IV length (NIST SP 800-38D). Random 96-bit IVs are safe for far more encryptions than one app will ever do with one key. Never reuse an IV with the same key.
- **AAD (associated data): `ownerId:NAME`.** The ciphertext is bound to its owner and name, so copying one user's encrypted value into another user's record (or renaming it in the database) makes decryption fail.
- **Stored format:** a single string, `v1.<iv>.<tag>.<ciphertext>` (base64url). The `v1` lets a future key rotation tell old values from new ones.

## How a secret flows
1. `POST /api/secrets { name, value }`: the value is encrypted and saved. No route ever returns a value. Listing shows names and dates only.
2. A workflow refers to it by name: header `Authorization: Bearer {{secrets.GITHUB_TOKEN}}`. The workflow JSON never contains the value.
3. **Only HTTP Request nodes may use `{{secrets.*}}`.** An Output or AI node that used one would write it into results or send it to an AI provider. Validation rejects this with a clear message before the run.
4. On execute, the service decrypts only the secrets the workflow references. A missing secret is a 400 before any record is made. The plaintext lives only in memory, in the engine's scope.
5. **Value-based redaction.** For that run, the runner replaces every occurrence of a decrypted value in anything it stores or streams with `[REDACTED]`: node inputs, outputs, errors and logs. This catches the cases key-name redaction can't, such as an echo API returning the token in its body.
6. **Saving rejects literal secrets.** An HTTP header or query parameter whose name looks sensitive (`Authorization`, `X-API-Key`, `token`, ...) must reference `{{secrets.NAME}}`. A typed-in value is refused with a message saying so.

## Risks and limits
- **Lose `SECRETS_KEY` and every stored secret is unrecoverable.** Users must re-enter them. It has to be kept like a database password (in the host's env settings and a password manager).
- The key sits next to the app, so this protects against **database exposure** (a leaked Atlas backup, a stolen connection string, read access to the DB). It does **not** protect against someone who controls the running server. A KMS or vault service would be the next step.
- A JSON request body typed into a node can't be checked reliably for embedded secrets; only headers and query params are enforced. The README says to use `{{secrets.NAME}}` in bodies too.
- Value redaction skips values shorter than 4 characters. Masking every "a" or "12" would make outputs unreadable, and values that short aren't real secrets anyway.
- Key rotation isn't implemented. The `v1` prefix leaves room for it.
