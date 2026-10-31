// Hides secret values before they are stored, logged or shown in the execution log.
// redactHeaders: HTTP node output (Phase 4). redactDeep: everything stored in an execution (Phase 5).
// createValueRedactor: the decrypted {{secrets.*}} values of one run, wherever they appear (Phase 6).

export const REDACTED = "[REDACTED]";

// Header (or field) names whose values are credentials. Exact names first, then a pattern for
// the many custom variants (x-api-key, x-auth-token, client_secret...).
const SENSITIVE_NAMES = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
const SENSITIVE_PATTERN = /token|secret|password|api[-_]?key|session/i;

export function isSensitiveName(name) {
    return SENSITIVE_NAMES.has(name.toLowerCase()) || SENSITIVE_PATTERN.test(name);
}

// { name: value } -> a copy with every sensitive value replaced. The original is not changed.
export function redactHeaders(headers) {
    return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, isSensitiveName(name) ? REDACTED : value])
    );
}


// MongoDB refuses documents nested deeper than 100 levels. A stored value sits a few levels down
// (execution -> nodes[i] -> output -> ...), so anything deeper than this is cut off with a marker.
// It also keeps a hostile, deeply nested API response from overflowing the stack here.
const MAX_DEPTH = 40;
export const TOO_DEEP = "[TRUNCATED: nested too deep]";

// Deep copy of a JSON-like value (node input/output, run input, logs) where every field whose
// NAME looks like a credential has its value replaced. Used before anything is stored or streamed.
// Values are not scanned: a secret pasted into a plain text field is not detected (README limitation).
export function redactDeep(value, depth = 0) {
    if (value === null || typeof value !== "object" || value instanceof Date) return value;
    if (depth >= MAX_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, isSensitiveName(key) ? REDACTED : redactDeep(item, depth + 1)])
    );
}

// Secrets shorter than this are not masked: hiding every "a" or "12" would wreck outputs, and a
// value that short is not a real credential (docs/decisions/secrets.md).
export const MIN_SECRET_LENGTH = 4;

// Returns a function that deep-copies a value, replacing every occurrence of the given secret
// VALUES inside strings (and object keys) with [REDACTED]. Complements redactDeep, which only
// looks at key names: this catches a secret echoed back in an API response body, or quoted in an
// error message such as "Invalid URL: https://x.test/?key=...". The URL-encoded form is masked
// too, since that is how a secret appears once it has been put into a query string.
export function createValueRedactor(values) {
    const needles = new Set();
    for (const value of values) {
        if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
        needles.add(value);
        needles.add(encodeURIComponent(value));
    }
    // Longest first, so a secret that contains another one is masked as a whole.
    const list = [...needles].sort((a, b) => b.length - a.length);
    if (list.length === 0) return (value) => value;

    const hide = (text) => list.reduce((out, needle) => out.split(needle).join(REDACTED), text);
    const walk = (value, depth = 0) => {
        if (typeof value === "string") return hide(value);
        if (value === null || typeof value !== "object" || value instanceof Date) return value;
        if (depth >= MAX_DEPTH) return TOO_DEEP;
        if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [hide(key), walk(item, depth + 1)]));
    };
    return walk;
}
