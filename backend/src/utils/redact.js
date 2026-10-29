// Hides secret values before they are stored, logged or shown in the execution log.
// Phase 4 uses it for HTTP headers; Phase 6 reuses it for the full redaction pass.

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
