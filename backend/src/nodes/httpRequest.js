import { z } from "zod";
import { keyValue, retry, isBlank } from "./shared.js";
import { NodeError } from "../engine/errors.js";
import { findEmptyExpressions } from "../engine/expressions.js";
import { safeFetch, SafeFetchError } from "../net/safeFetch.js";
import { redactHeaders } from "../utils/redact.js";
import { env } from "../config/env.js";

// HTTP Request: calls a URL and outputs { status, headers, body }.
//
// Security lives in net/safeFetch.js (SSRF). This file turns the node config into a request and
// turns every outcome into either an output or a NodeError that says whether a retry can help:
//   429, 502, 503, 504, network errors   retryable (the server or network may recover)
//   other 4xx/5xx, blocked URL, bad body  not retryable (same request = same failure)
// Timeouts and Stop are handled by the engine through `signal`.

// The engine retries transient failures 3 times (1 s, then 2 s) unless the node config says otherwise.
const defaultRetry = { maxAttempts: 3, backoffMs: 1000 };

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
// Headers that describe the connection, not the request. fetch sets them itself; letting a user
// set them could break the request or smuggle a second one.
const FORBIDDEN_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer"]);
const METHODS_WITHOUT_BODY = new Set(["GET", "DELETE"]);

export function createHttpRequestHandler(fetchImpl) {
    return async function execute({ config, signal, node, scope }) {
        // Fail before sending anything if an expression in the URL came out empty
        // ("/posts/{{input.postId}}" run with {"todoId": 1} would otherwise fetch "/posts/").
        if (scope) {
            const [missing] = findEmptyExpressions(node?.data?.config?.url, scope);
            if (missing) {
                const where = /^\{\{\s*input\./.test(missing) ? "the Run input" : "the earlier node's output";
                throw new NodeError(`URL expression ${missing} is empty. Check ${where}`);
            }
        }
        const method = config.method ?? "GET";
        const url = buildUrl(config.url, config.query);
        const headers = buildHeaders(config.headers);
        const body = buildBody(config.body, method, headers);

        let response;
        try {
            response = await fetchImpl(url, {
                method,
                headers,
                body,
                signal,
                maxBytes: env.HTTP_MAX_RESPONSE_BYTES,
                maxRedirects: env.HTTP_MAX_REDIRECTS,
            });
        } catch (error) {
            throw toNodeError(error, signal);
        }

        if (response.status >= 400) {
            const message = `HTTP ${response.status} from ${new URL(response.url).host}${snippet(response.body)}`;
            throw new NodeError(message, {
                retryable: RETRYABLE_STATUSES.has(response.status),
                retryAfterMs: parseRetryAfter(response.headers["retry-after"]),
            });
        }

        return {
            output: {
                status: response.status,
                headers: redactHeaders(response.headers), // e.g. set-cookie never reaches storage
                body: parseBody(response.body),
            },
        };
    };
}

export const httpRequest = {
    configSchema: z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
        url: z.string().max(2048).optional(),
        query: z.array(keyValue).max(50).optional(),
        headers: z.array(keyValue).max(50).optional(),
        body: z.string().max(100000).optional(), // JSON text, may contain {{expressions}}
        timeoutMs: z.number().int().min(1000).max(120000).optional(),
        retry: retry.optional(),
    }),
    requiredFields: (c) => (isBlank(c.url) ? ["URL"] : []),
    defaultRetry,
    execute: createHttpRequestHandler(safeFetch),
};

function buildUrl(rawUrl, query = []) {
    let url;
    try {
        url = new URL(String(rawUrl).trim());
    } catch {
        throw new NodeError(`Invalid URL: "${rawUrl}"`);
    }
    // searchParams encodes the values, so an expression result cannot break the URL.
    for (const { key, value } of query) {
        if (!isBlank(key)) url.searchParams.append(key, String(value));
    }
    return url.href;
}

function buildHeaders(list = []) {
    const headers = {};
    for (const { key, value } of list) {
        if (isBlank(key)) continue;
        const name = key.trim();
        if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new NodeError(`Header "${name}" cannot be set`);
        headers[name] = String(value);
    }
    return headers;
}

// The body is JSON. After expression resolution it is either still JSON text, or (when the whole
// body was one expression like {{nodes.x.output}}) the real object.
function buildBody(body, method, headers) {
    if (body === undefined || body === null || (typeof body === "string" && isBlank(body))) return undefined;
    if (METHODS_WITHOUT_BODY.has(method)) throw new NodeError(`${method} requests cannot have a body`);

    let text;
    if (typeof body === "string") {
        try {
            JSON.parse(body); // validate only; we send the user's text as written
        } catch (error) {
            throw new NodeError(`Body is not valid JSON: ${error.message}`);
        }
        text = body;
    } else {
        text = JSON.stringify(body);
    }
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
    if (!hasContentType) headers["Content-Type"] = "application/json";
    return text;
}

// "body parsed as JSON when possible": JSON stays structured so later nodes can read fields
// with {{nodes.http.output.body.x}}; anything else stays text.
function parseBody(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

// Retry-After is either seconds ("120") or an HTTP date. Returns ms, or null if absent/unreadable.
export function parseRetryAfter(value) {
    if (!value) return null;
    if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// A short piece of an error body helps debugging ("HTTP 400 from api.x.com: missing field id").
function snippet(body) {
    const text = String(body ?? "").replace(/\s+/g, " ").trim();
    return text ? `: ${text.slice(0, 200)}` : "";
}

function toNodeError(error, signal) {
    // Aborted (Stop or timeout): rethrow as-is; the engine knows which one it was.
    if (signal?.aborted) return error;
    if (error instanceof SafeFetchError) return new NodeError(error.message); // blocked, too large... never retried

    // undici reports network failures as TypeError("fetch failed") with the real reason in `cause`.
    const cause = error.cause ?? error;
    const code = cause.code ?? "";
    if (code === "ENOTFOUND") return new NodeError(`Host not found (${cause.hostname ?? "DNS lookup failed"})`);
    // Everything else (connection refused/reset, DNS temporarily unavailable, TLS hiccup) may be
    // temporary, so it is worth another attempt.
    return new NodeError(`Request failed: ${code || cause.message}`, { retryable: true });
}
