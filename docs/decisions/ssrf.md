# Decision: SSRF protection for the HTTP Request node

## Problem
The HTTP node fetches any URL a user types. Without checks, a user could make our server call `http://169.254.169.254/` (cloud credentials), `http://localhost:27017`, or hosts on the private network. This is Server-Side Request Forgery (SSRF). SPEC section 7 requires: http/https only, DNS resolved and checked (private, loopback, link-local, metadata, IPv6 too), every redirect re-checked, a redirect limit, a response-size limit, and protection against DNS rebinding by connecting to the validated IP.

## Options considered
| Option | License (checked 2026-10-29) | Maintained | Notes |
|---|---|---|---|
| [request-filtering-agent](https://github.com/azu/request-filtering-agent) | MIT | yes, npm publish 2026-06 | Good design: an `http.Agent` that checks the address after DNS lookup, so it is rebinding-safe. Uses ipaddr.js. But its README says Node's built-in `fetch` does not support `http.Agent`; we would need axios or node-fetch. |
| [ssrf-req-filter](https://github.com/y-mehta/ssrf-req-filter) | MIT | no, last publish 2024-05 | Same agent idea. Rejected: no release in the last 12 months, and its README documents that a custom `lookup` bypasses the check. |
| [ipaddr.js](https://github.com/whitequark/ipaddr.js) + [undici](https://github.com/nodejs/undici) `Agent({ connect: { lookup } })` | both MIT | yes, 2026-08 / 2026-10 | ipaddr.js parses and classifies IPv4/IPv6 addresses (used by Express itself and by request-filtering-agent). undici is the HTTP client behind Node's `fetch`; its `Agent` lets us replace DNS lookup for every socket. |

## Choice
ipaddr.js + undici, with our own small glue in `backend/src/net/`:
- `ipPolicy.js` `isPublicAddress(ip)`: **allow-list**. Only addresses that ipaddr.js classifies as `unicast` pass. IPv4-mapped IPv6 is unwrapped first. A forgotten range is blocked, not allowed.
- `safeFetch.js` `createSafeFetch()`:
  1. Only `http:` / `https:`.
  2. IP-literal hosts are checked before the request (sockets skip DNS for them). WHATWG `URL` already turns `http://2130706433/` and `http://0x7f.1/` into `127.0.0.1`.
  3. A custom `lookup` resolves the hostname, rejects if **any** address is not public, and returns exactly those addresses to the socket. No second lookup = no DNS rebinding window.
  4. `redirect: "manual"`; at most 5 redirects; each hop goes through 1-3 again. Credentials (`Authorization`, `Cookie`) are dropped when a redirect changes origin.
  5. The response body is read in chunks and aborted past 1 MB (Content-Length is only a fast path; it can lie).

Why this over request-filtering-agent: same core technique (check at lookup time), but it keeps the standard `fetch` API with native `AbortSignal` support, which the engine needs for cancellation and timeouts, and every check is visible in ~150 lines we can test and explain. The hard part (IP parsing) is still a vetted dependency.

`undici` is pinned to v7: v8 requires Node >= 22.19 and this project runs on 22.14. We use undici's own `fetch` together with its `Agent`, because combining the npm `Agent` with Node's built-in `fetch` depends on matching internal versions.

## What was borrowed
Ideas only, no code: request-filtering-agent's "check the address at DNS lookup time" approach and its use of ipaddr.js `range()`; the fetch standard's redirect method rules.

## Risks and limits
- Ports are not restricted. A public host on any port is reachable. Acceptable for a workflow tool; could be limited to 80/443 later.
- An HTTP proxy, if ever added, would bypass the lookup check (the proxy does the DNS). Do not add `HTTP_PROXY` support without revisiting this.
- Pooled keep-alive sockets were validated when they opened. A DNS change cannot affect them, because they are already connected to a checked IP.
- If the server runs inside a network where "public" addresses are internal (unusual corporate setups), the allow-list does not know that. Deployment notes (Phase 6) should mention egress firewall rules as a second layer.
