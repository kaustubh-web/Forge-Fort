import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";
import { isPublicAddress } from "./ipPolicy.js";

// An HTTP client that can only reach public addresses (SSRF protection, docs/decisions/ssrf.md).
//
//   1. Only http: and https: URLs.
//   2. IP-literal hosts (http://10.0.0.1/) are checked before the request.
//   3. Hostnames are resolved by our own `lookup`, which rejects the request if ANY resolved
//      address is not public, and hands the socket exactly the address it checked.
//      There is no second DNS lookup, so DNS rebinding (public IP at check time, private IP
//      at connect time) cannot slip through.
//   4. Redirects are followed by hand, at most `maxRedirects`, and every hop repeats 1-3.
//   5. The body is read in chunks and the request is aborted as soon as it passes `maxBytes`.
//
// `resolve` and `isAllowed` can be replaced, but only tests do that (to point a fake public
// hostname at a local test server). Production code uses the defaults.

// Expected, explainable refusals. `code` tells the caller what happened.
export class SafeFetchError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SafeFetchError";
        this.code = code; // BAD_URL | BLOCKED | TOO_MANY_REDIRECTS | TOO_LARGE
    }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Credentials must not follow a redirect to another origin (browsers drop them too).
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

async function resolveAll(hostname) {
    // verbatim: keep the resolver's order instead of re-sorting IPv4 first.
    return dnsLookup(hostname, { all: true, verbatim: true });
}

export function createSafeFetch({ resolve = resolveAll, isAllowed = isPublicAddress } = {}) {
    // Called by the socket instead of Node's normal DNS lookup (same callback signature).
    // Node calls it with options.all = true when it wants every address (happy eyeballs).
    function guardedLookup(hostname, options, callback) {
        resolve(hostname).then(
            (addresses) => {
                if (!addresses.length) return callback(new SafeFetchError("BLOCKED", `Could not resolve ${hostname}`));
                // Check every address, not just the first: the socket may try any of them.
                const blocked = addresses.find((a) => !isAllowed(a.address));
                if (blocked) {
                    return callback(new SafeFetchError("BLOCKED", `Blocked: ${hostname} resolves to a non-public address (${blocked.address})`));
                }
                if (options.all) return callback(null, addresses);
                const match = addresses.find((a) => !options.family || a.family === options.family) ?? addresses[0];
                callback(null, match.address, match.family);
            },
            (error) => callback(error)
        );
    }

    // One connection pool for this client. Every socket it opens goes through guardedLookup.
    const agent = new Agent({ connect: { lookup: guardedLookup } });

    // Rules that need only the URL itself (run on the first URL and on every redirect).
    function checkUrl(url) {
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new SafeFetchError("BAD_URL", `Only http and https URLs are allowed (got ${url.protocol})`);
        }
        // URL keeps IPv6 hosts in brackets: [::1]. WHATWG URL parsing has already turned tricks
        // like http://2130706433/ or http://0x7f.1/ into plain 127.0.0.1.
        const host = url.hostname.replace(/^\[|\]$/g, "");
        // The socket skips DNS for IP literals, so guardedLookup would never see them: check here.
        if (isIP(host) && !isAllowed(host)) {
            throw new SafeFetchError("BLOCKED", `Blocked: ${host} is not a public address`);
        }
    }

    return async function safeFetch(
        rawUrl,
        { method = "GET", headers = {}, body, signal, maxRedirects = 5, maxBytes = 1024 * 1024 } = {}
    ) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            throw new SafeFetchError("BAD_URL", `Invalid URL: ${rawUrl}`);
        }
        let currentHeaders = { ...headers };
        let currentMethod = method;
        let currentBody = body;

        for (let hop = 0; ; hop++) {
            checkUrl(url);

            let response;
            try {
                response = await fetch(url, {
                    method: currentMethod,
                    headers: currentHeaders,
                    body: currentBody,
                    signal,
                    redirect: "manual", // we follow redirects ourselves so each hop is checked
                    dispatcher: agent,
                });
            } catch (error) {
                // undici wraps connect errors as TypeError("fetch failed", { cause }).
                // Surface our own refusal (from guardedLookup) instead of the generic wrapper.
                if (error.cause instanceof SafeFetchError) throw error.cause;
                throw error;
            }

            const location = response.headers.get("location");
            if (REDIRECT_STATUSES.has(response.status) && location) {
                await response.body?.cancel(); // we will not read this body
                if (hop >= maxRedirects) {
                    throw new SafeFetchError("TOO_MANY_REDIRECTS", `Too many redirects (max ${maxRedirects})`);
                }
                const next = new URL(location, url);
                if (next.origin !== url.origin) {
                    currentHeaders = Object.fromEntries(
                        Object.entries(currentHeaders).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase()))
                    );
                }
                // Same rule as the fetch standard: 303, or 301/302 after a POST, becomes a GET without a body.
                if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
                    currentMethod = "GET";
                    currentBody = undefined;
                }
                url = next;
                continue;
            }

            const bytes = await readLimited(response, maxBytes);
            return {
                status: response.status,
                headers: Object.fromEntries(response.headers),
                body: bytes.toString("utf8"),
                url: url.href,
            };
        }
    };
}

// Read the body, but never more than maxBytes. Content-Length is checked first as a fast path,
// then real bytes are counted, because the header can be missing or wrong.
async function readLimited(response, maxBytes) {
    const tooLarge = () => new SafeFetchError("TOO_LARGE", `Response is larger than ${maxBytes} bytes`);

    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) {
        await response.body?.cancel();
        throw tooLarge();
    }

    const chunks = [];
    let total = 0;
    if (!response.body) return Buffer.alloc(0);
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes) {
            // Leaving the loop early cancels the stream, which closes the connection.
            throw tooLarge();
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

// The client the HTTP node uses.
export const safeFetch = createSafeFetch();
