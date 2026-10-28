import { NodeError } from "./errors.js";

// Safe expression resolver (decision note: docs/decisions/expressions.md).
//
// An expression is a dotted path in double braces:
//   {{nodes.http-1.output.body.title}}   output of an earlier node
//   {{input.email}}                      the trigger input from the Run dialog
//   {{item.name}}                        the current array item (Transform "map" only)
// The text inside the braces is only ever split on dots and walked as a path.
// It is never evaluated: no eval, no Function, no vm.

// Finds {{ ... }}. Braces inside are not allowed, so expressions cannot nest.
// The pattern is deliberately simple (no overlapping \s* around a lazy group), so a long
// malicious string cannot cause catastrophic backtracking. Spaces are trimmed in parsePath.
const EXPRESSION = /\{\{([^{}]*)\}\}/g;
const WHOLE_EXPRESSION = /^\{\{([^{}]*)\}\}$/;

const ROOTS = ["nodes", "input", "item"];

// These keys lead to an object's prototype. Reading through them could expose or (in other
// code) modify built-in objects, so they are rejected anywhere in a path.
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// "nodes.http-1.output.body" -> { root, nodeId, keys } or { error }.
// Used both by validation (before the run) and by resolution (during the run).
export function parsePath(rawPath) {
    const path = rawPath.trim();
    const parts = path.split(".").map((part) => part.trim());
    if (parts.some((part) => part === "")) return { error: `Invalid expression "{{${path}}}"` };
    if (parts.some((part) => BLOCKED_KEYS.has(part))) {
        return { error: `Expression "{{${path}}}" uses a forbidden key` };
    }

    const [root, ...rest] = parts;
    if (!ROOTS.includes(root)) {
        return { error: `Expression "{{${path}}}" must start with nodes, input or item` };
    }
    if (root !== "nodes") return { root, keys: rest };

    // Only a node's output is exposed: {{nodes.<id>.output...}}
    const [nodeId, field, ...keys] = rest;
    if (!nodeId || field !== "output") {
        return { error: `Expression "{{${path}}}" must look like {{nodes.<id>.output...}}` };
    }
    return { root, nodeId, keys };
}

// Walk own properties only. A missing field gives undefined (like ?.): that is data, not a bug.
function walk(value, keys) {
    let current = value;
    for (const key of keys) {
        if (current === null || typeof current !== "object") return undefined;
        if (!Object.hasOwn(current, key)) return undefined;
        current = current[key];
    }
    return current;
}

// Sentinel: "leave this expression as text". Config resolution does not know the current item
// yet, so {{item.x}} stays in place until Transform resolves it per item.
const KEEP = Symbol("keep");

// scope = { nodes: { [id]: { status, output } }, input, item? }
function resolvePath(rawPath, scope) {
    const path = rawPath.trim();
    const parsed = parsePath(path);
    if (parsed.error) throw new NodeError(parsed.error);

    if (parsed.root === "input") return walk(scope.input, parsed.keys);
    if (parsed.root === "item") return "item" in scope ? walk(scope.item, parsed.keys) : KEEP;

    // Referencing a node that does not exist or did not succeed is a configuration bug,
    // so it fails loudly instead of quietly turning into an empty value.
    const node = Object.hasOwn(scope.nodes, parsed.nodeId) ? scope.nodes[parsed.nodeId] : undefined;
    if (!node) throw new NodeError(`Expression "{{${path}}}" refers to node "${parsed.nodeId}", which has not run`);
    if (node.status !== "success") {
        throw new NodeError(`Expression "{{${path}}}" refers to node "${parsed.nodeId}", which was ${node.status}`);
    }
    return walk(node.output, parsed.keys);
}

// Value -> text for expressions embedded in a larger string.
function toText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

// A string that is exactly one expression keeps the value's type (a number stays a number,
// an object stays an object). Expressions inside a larger string are turned into text.
export function resolveTemplate(text, scope) {
    const whole = text.match(WHOLE_EXPRESSION);
    if (whole) {
        const value = resolvePath(whole[1], scope);
        return value === KEEP ? text : value;
    }
    return text.replace(EXPRESSION, (match, path) => {
        const value = resolvePath(path, scope);
        return value === KEEP ? match : toText(value);
    });
}

// Resolve every string inside a config (objects and arrays, any depth). Returns a new value;
// the stored workflow config is never modified.
export function resolveConfig(value, scope) {
    if (typeof value === "string") return resolveTemplate(value, scope);
    if (Array.isArray(value)) return value.map((item) => resolveConfig(item, scope));
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, inner] of Object.entries(value)) result[key] = resolveConfig(inner, scope);
        return result;
    }
    return value;
}

// Every expression inside a config, parsed. Used by validation to reject bad syntax and
// references to nodes that are not ancestors, before anything runs.
export function findExpressions(value, found = []) {
    if (typeof value === "string") {
        for (const [, path] of value.matchAll(EXPRESSION)) found.push({ path, ...parsePath(path) });
    } else if (Array.isArray(value)) {
        for (const item of value) findExpressions(item, found);
    } else if (value && typeof value === "object") {
        for (const inner of Object.values(value)) findExpressions(inner, found);
    }
    return found;
}
