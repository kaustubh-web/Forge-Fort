# Decision: authenticating the SSE stream, and how the client reads it

## Problem
Live updates use Server-Sent Events at `GET /api/executions/:id/stream` (SPEC section 8). The browser's native `EventSource` cannot set request headers, so it cannot send our `Authorization: Bearer <token>`. Every route must enforce auth and ownership, so the stream needs another way to prove who is asking.

## Options considered

| Option | How it authenticates | Verdict |
|---|---|---|
| **A. Short-lived stream token** | `POST /executions/:id/stream-token` returns a token valid for about 60 s, scoped to one execution; `new EventSource(".../stream?token=...")` | Rejected. The token sits in the URL, and URLs end up in server and proxy access logs, browser history and error reports. It also needs a second endpoint, token signing/expiry rules, and a new token for every reconnect. |
| **B. Cookie auth for the stream only** | `EventSource(url, { withCredentials: true })` with an httpOnly cookie | Rejected. We use Bearer tokens (`docs/decisions/auth-storage.md`); adding cookies only for this means CSRF protection and a second auth path. |
| **C. `fetch()` with the normal Bearer header, reading `response.body` as a stream** | Exactly like every other API call | **Chosen.** |

## Choice: fetch-based reader (C)
- The server side is a normal Express route behind `requireAuth`. Ownership is checked by the same `getExecution()` as `GET /executions/:id`, so another user's id is a JSON 404 before any stream starts.
- The browser calls `fetch(url, { headers: { Authorization }, signal })` and parses `response.body` as SSE. An `AbortController` closes it (on unmount, or when the run ends).
- Downside: `EventSource`'s automatic reconnect is gone, so we write our own. That turns out simpler, because of the snapshot design below.

## Reconnect without event ids: the snapshot-first stream
Every connection starts with `event: snapshot` (the execution as persisted in MongoDB), followed by live events. A finished execution gets only the snapshot, then the stream closes.
- The runner persists each change **before** it publishes it (`executions/executionRunner.js`). So the snapshot is never behind what the stream already showed.
- The stream **subscribes before** it reads the snapshot and buffers events until the snapshot is sent (`controllers/streamController.js`). An event can therefore show up in both the snapshot and the stream, but never in neither. Applying a node record twice gives the same state, so duplicates are harmless. A test injects an event during the snapshot read to prove nothing is lost.
- Reconnecting is "open the stream again": no `Last-Event-ID`, no replay buffer on the server, no state that grows with the number of viewers.

## Client parsing library
| Library | License (checked in repo) | Activity | Verdict |
|---|---|---|---|
| [eventsource-parser](https://github.com/rexxars/eventsource-parser) | MIT, (c) Espen Hovlandsdal | 4 releases Aug-Oct 2026, no runtime dependencies | **Chosen.** Only parses the SSE text format; we keep control of fetch, auth and reconnect. |
| [@microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source) | MIT | Last release 2.0.1, April 2021; 51 open issues | Rejected: not maintained in the last 12 months. |
| [eventsource](https://github.com/EventSource/eventsource) v5 | MIT | Active | Rejected: a full `EventSource` replacement with its own reconnect logic, which would fight our snapshot-based reconnect. |

Pinned to an exact version that has been public for at least two weeks (`eventsource-parser@4.1.2`, released 2026-10-12) instead of the release from a few days ago, as a small guard against a compromised fresh release.

Nothing was copied from any of these projects.

## Other details
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Proxies must not cache, compress or buffer the stream.
- A `: ping` comment every 15 s keeps idle connections open through proxies.
- When the client disconnects, the server unsubscribes from the hub and clears the heartbeat (tested).

## Risks / limitations
- The hub is in memory: a viewer must be connected to the same server instance that runs the execution (the documented single-instance limitation).
- An execution stuck as `running` with no engine (only possible if boot recovery did not run) would keep a stream open with heartbeats only. Cancel finishes such records.
- Node events carry the full node record (redacted). This is bounded by the node limits (HTTP body 1 MB), but a large response is sent to the browser in full.
