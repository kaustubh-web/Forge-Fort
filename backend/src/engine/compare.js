import { NodeError } from "./errors.js";

// The comparison operators shared by the Condition node and the Transform "filter" operation.
// Values often arrive as text (a config field typed in the UI is a string), so the rules are:
//   equals / notEquals   numbers if both sides look numeric ("200" equals 200), otherwise text
//   contains             text contains text, or a list contains an item (same equality rule)
//   greaterThan/lessThan both sides must be numeric, anything else is an error
//   isEmpty / isNotEmpty undefined, null, "", [] and {} are empty

export function isNumeric(value) {
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

export function isEmpty(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

function toText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

// Short version of a value for error messages.
function preview(value) {
    const text = value === undefined ? "undefined" : toText(value);
    return text.length > 50 ? `${text.slice(0, 50)}...` : text;
}

function equal(a, b) {
    if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
    return toText(a) === toText(b);
}

function numbers(operator, a, b) {
    if (!isNumeric(a) || !isNumeric(b)) {
        throw new NodeError(`${operator} needs two numbers, got "${preview(a)}" and "${preview(b)}"`);
    }
    return [Number(a), Number(b)];
}

export function compare(left, operator, right) {
    switch (operator) {
        case "equals":
            return equal(left, right);
        case "notEquals":
            return !equal(left, right);
        case "contains":
            if (Array.isArray(left)) return left.some((item) => equal(item, right));
            if (typeof left === "string" || typeof left === "number") return String(left).includes(toText(right));
            throw new NodeError(`contains needs text or a list on the left, got "${preview(left)}"`);
        case "greaterThan": {
            const [a, b] = numbers(operator, left, right);
            return a > b;
        }
        case "lessThan": {
            const [a, b] = numbers(operator, left, right);
            return a < b;
        }
        case "isEmpty":
            return isEmpty(left);
        case "isNotEmpty":
            return !isEmpty(left);
        default:
            throw new NodeError(`Unknown operator "${operator}"`);
    }
}
