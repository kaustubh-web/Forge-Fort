// Checks a value against a small subset of JSON Schema, for the AI node's "extract" mode.
//
// Why our own and not ajv: ajv compiles each schema into JavaScript with `new Function`, and these
// schemas are typed by users. CLAUDE.md forbids running anything built from user input. This
// checker only walks the schema as data, so a schema can never run code.
//
// Supported keywords: type, properties, required, items, enum (+ title/description, ignored).
// Enough to describe "an object with these fields of these types", which is what extract needs.

const KEYWORDS = new Set(["type", "properties", "required", "items", "enum", "title", "description"]);
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

// Is the schema itself usable? Returns a list of problems (empty = fine).
export function checkSchema(schema, path = "schema") {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [`${path} must be an object`];
    const problems = [];
    for (const key of Object.keys(schema)) {
        if (!KEYWORDS.has(key)) problems.push(`${path}: "${key}" is not supported (use ${[...KEYWORDS].slice(0, 5).join(", ")})`);
    }
    const types = schema.type === undefined ? [] : [schema.type].flat();
    for (const type of types) if (!TYPES.has(type)) problems.push(`${path}: unknown type "${type}"`);
    if (schema.enum !== undefined && !Array.isArray(schema.enum)) problems.push(`${path}: enum must be an array`);
    if (schema.required !== undefined && !Array.isArray(schema.required)) problems.push(`${path}: required must be an array`);
    if (schema.properties !== undefined) {
        if (typeof schema.properties !== "object" || schema.properties === null) problems.push(`${path}: properties must be an object`);
        else for (const [name, sub] of Object.entries(schema.properties)) problems.push(...checkSchema(sub, `${path}.properties.${name}`));
    }
    if (schema.items !== undefined) problems.push(...checkSchema(schema.items, `${path}.items`));
    return problems;
}

// Does the value match? Returns the first problem as a sentence the model can act on, or null.
export function validateShape(value, schema, path = "$") {
    if (schema.type !== undefined) {
        const types = [schema.type].flat();
        if (!types.some((type) => hasType(value, type))) return `${path} should be ${types.join(" or ")}, got ${typeName(value)}`;
    }
    if (schema.enum && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
        return `${path} should be one of ${JSON.stringify(schema.enum)}`;
    }
    if (isPlainObject(value)) {
        for (const name of schema.required ?? []) {
            if (!Object.hasOwn(value, name)) return `${path}.${name} is required`;
        }
        for (const [name, sub] of Object.entries(schema.properties ?? {})) {
            if (Object.hasOwn(value, name)) {
                const problem = validateShape(value[name], sub, `${path}.${name}`);
                if (problem) return problem;
            }
        }
    }
    if (Array.isArray(value) && schema.items) {
        for (let i = 0; i < value.length; i++) {
            const problem = validateShape(value[i], schema.items, `${path}[${i}]`);
            if (problem) return problem;
        }
    }
    return null;
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function hasType(value, type) {
    if (type === "object") return isPlainObject(value);
    if (type === "array") return Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "null") return value === null;
    return typeof value === type; // string, number, boolean
}

function typeName(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}
