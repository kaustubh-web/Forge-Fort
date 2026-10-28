import { z } from "zod";
import { NodeError } from "../engine/errors.js";
import { compare } from "../engine/compare.js";
import { getPath, splitFieldPath, resolveTemplate } from "../engine/expressions.js";
import { CONDITION_OPERATORS } from "./shared.js";

// A transform operation is a type plus a few simple parameters. No user code, ever.
const transformOperation = z.object({
    type: z.enum(["select", "rename", "filter", "map", "merge", "convert"]),
    params: z
        .record(
            z.string().max(100),
            z.union([
                z.string().max(2000),
                z.number(),
                z.boolean(),
                z.array(z.string().max(500)).max(100),
            ])
        )
        .default({}),
});

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Copy-on-write set of a dotted path: returns a new value, never mutates the input
// (the input is another node's output, which must stay as it was recorded).
function setPath(target, keys, value) {
    if (keys.length === 0) return value;
    const [key, ...rest] = keys;
    const copy = Array.isArray(target) ? [...target] : { ...(isPlainObject(target) ? target : {}) };
    // defineProperty instead of `copy[key] =` so even an odd key can never touch the prototype.
    Object.defineProperty(copy, key, {
        value: setPath(copy[key], rest, value),
        enumerable: true,
        writable: true,
        configurable: true,
    });
    return copy;
}

function requireParam(op, name) {
    const value = op.params[name];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
        throw new NodeError(`Transform "${op.type}" needs the "${name}" parameter`);
    }
    return value;
}

// Apply fn to an object, or to every item if the data is a list.
function eachItem(data, opType, fn) {
    if (Array.isArray(data)) return data.map((item) => eachItem(item, opType, fn));
    if (!isPlainObject(data)) throw new NodeError(`Transform "${opType}" needs an object or a list of objects`);
    return fn(data);
}

// The array at `path` ("" or missing = the data itself), plus a function to put a new one back.
function arrayAt(data, path, opType) {
    const keys = path ? splitFieldPath(path) : [];
    const list = keys.length ? getPath(data, path) : data;
    if (!Array.isArray(list)) {
        throw new NodeError(`Transform "${opType}": ${path ? `"${path}"` : "the input"} is not a list`);
    }
    return { list, put: (newList) => setPath(data, keys, newList) };
}

function toNumber(value, field) {
    const number = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(number)) throw new NodeError(`Cannot convert "${field}" (${JSON.stringify(value)}) to a number`);
    return number;
}

function toBoolean(value, field) {
    if (value === true || value === "true" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === 0 || value === "0") return false;
    throw new NodeError(`Cannot convert "${field}" (${JSON.stringify(value)}) to a boolean`);
}

function toDate(value, field) {
    const date = new Date(value);
    if (value === null || value === "" || Number.isNaN(date.getTime())) {
        throw new NodeError(`Cannot convert "${field}" (${JSON.stringify(value)}) to a date`);
    }
    return date.toISOString();
}

const converters = {
    string: (value) => (value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")),
    number: toNumber,
    boolean: toBoolean,
    date: toDate,
};

// One function per operation type: (data, op) -> new data.
const operations = {
    // Keep only the listed top-level fields.
    select: (data, op) => {
        const fields = requireParam(op, "fields");
        const list = Array.isArray(fields) ? fields : [fields];
        list.forEach((field) => splitFieldPath(field)); // rejects forbidden keys
        return eachItem(data, op.type, (obj) =>
            Object.fromEntries(list.filter((field) => Object.hasOwn(obj, field)).map((field) => [field, obj[field]]))
        );
    },

    // Rename one top-level field. A missing field is left alone (nothing to rename).
    rename: (data, op) => {
        const from = String(requireParam(op, "from"));
        const to = String(requireParam(op, "to"));
        splitFieldPath(from);
        splitFieldPath(to);
        return eachItem(data, op.type, (obj) => {
            if (!Object.hasOwn(obj, from)) return obj;
            const entries = Object.entries(obj).map(([key, value]) => [key === from ? to : key, value]);
            return Object.fromEntries(entries);
        });
    },

    // Keep the items of a list whose `field` passes the comparison (same operators as Condition).
    filter: (data, op) => {
        const operator = requireParam(op, "operator");
        if (!CONDITION_OPERATORS.includes(operator)) throw new NodeError(`Unknown operator "${operator}"`);
        const { list, put } = arrayAt(data, op.params.path, op.type);
        const field = op.params.field;
        return put(list.filter((item) => compare(field ? getPath(item, field) : item, operator, op.params.value)));
    },

    // Set `field` on every item. The value may use {{item.x}} to read from the current item.
    map: (data, op) => {
        const keys = splitFieldPath(requireParam(op, "field"));
        const { list, put } = arrayAt(data, op.params.path, op.type);
        return put(
            list.map((item) => {
                const value =
                    typeof op.params.value === "string"
                        ? resolveTemplate(op.params.value, { nodes: {}, input: undefined, item })
                        : op.params.value;
                return setPath(item, keys, value);
            })
        );
    },

    // Shallow-merge an object into the data. `source` is usually {{nodes.x.output...}}.
    merge: (data, op) => {
        const source = requireParam(op, "source");
        if (!isPlainObject(source)) throw new NodeError('Transform "merge": "source" must be an object');
        if (!isPlainObject(data)) throw new NodeError('Transform "merge" needs an object as input');
        return { ...data, ...source };
    },

    // Convert one field to string, number, boolean or date (ISO text).
    convert: (data, op) => {
        const field = String(requireParam(op, "field"));
        const to = requireParam(op, "to");
        const convert = converters[to];
        if (!convert) throw new NodeError(`Cannot convert to "${to}"`);
        const keys = splitFieldPath(field);
        return eachItem(data, op.type, (obj) => setPath(obj, keys, convert(getPath(obj, field), field)));
    },
};

// Transform Data: reshapes its input with an ordered list of predefined operations.
// Each operation receives the result of the previous one.
export const transform = {
    configSchema: z.object({
        operations: z.array(transformOperation).max(50).optional(),
    }),
    requiredFields: (c) => (c.operations?.length ? [] : ["At least one operation"]),
    execute: ({ config, input }) => {
        let data = input;
        (config.operations ?? []).forEach((op, i) => {
            try {
                data = operations[op.type](data, op);
            } catch (error) {
                // Say which step failed: "Operation 2 (convert): Cannot convert ..."
                // Anything that is not a NodeError is a bug in our code, so it is not relabelled.
                if (!(error instanceof NodeError)) throw error;
                throw new NodeError(`Operation ${i + 1} (${op.type}): ${error.message}`);
            }
        });
        return { output: data };
    },
};
