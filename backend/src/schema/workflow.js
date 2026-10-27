import { z } from "zod";
import { env } from "../config/env.js";
import { nodeRegistry, NODE_TYPES } from "../nodes/registry.js";

// IDs end up inside expressions like {{nodes.http-1.output.body}}, which are split on dots.
// So an id must never contain a dot (or spaces, or anything odd).
const id = z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, numbers, - and _ are allowed");

const coordinate = z.number().min(-1000000).max(1000000);

// One schema per node type, joined on the "type" field: the config is checked against the
// schema that belongs to that type.
const nodeSchemas = NODE_TYPES.map((type) =>
    z.object({
        id,
        type: z.literal(type),
        position: z.object({ x: coordinate, y: coordinate }),
        data: z.object({
            label: z.string().trim().max(100).default(""),
            config: nodeRegistry[type].configSchema.default({}),
        }),
    })
);
const nodeSchema = z.discriminatedUnion("type", nodeSchemas);

const edgeSchema = z.object({
    id,
    source: id,
    target: id,
    // Only a condition node has named outputs. undefined/null both mean "the default handle".
    sourceHandle: z
        .enum(["true", "false"])
        .nullish()
        .transform((handle) => handle ?? null),
});

export const workflowSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(100),
        description: z.string().trim().max(500).default(""),
        nodes: z.array(nodeSchema).max(env.MAX_NODES, `At most ${env.MAX_NODES} nodes`),
        edges: z.array(edgeSchema).max(env.MAX_EDGES, `At most ${env.MAX_EDGES} edges`),
    })
    .superRefine((workflow, ctx) => {
        const problem = (path, message) => ctx.addIssue({ code: "custom", path, message });

        // Unique node ids
        const nodeById = new Map();
        workflow.nodes.forEach((node, i) => {
            if (nodeById.has(node.id)) problem(["nodes", i, "id"], `Duplicate node id "${node.id}"`);
            nodeById.set(node.id, node);
        });

        // Edges: unique ids, real endpoints, valid handles, no self loops, no duplicates
        const edgeIds = new Set();
        const edgeKeys = new Set();
        workflow.edges.forEach((edge, i) => {
            if (edgeIds.has(edge.id)) problem(["edges", i, "id"], `Duplicate edge id "${edge.id}"`);
            edgeIds.add(edge.id);

            const source = nodeById.get(edge.source);
            if (!source) problem(["edges", i, "source"], `Unknown source node "${edge.source}"`);
            if (!nodeById.has(edge.target)) {
                problem(["edges", i, "target"], `Unknown target node "${edge.target}"`);
            }
            if (edge.source === edge.target) problem(["edges", i], "A node cannot connect to itself");

            if (source) {
                const isCondition = source.type === "condition";
                if (isCondition && edge.sourceHandle === null) {
                    problem(["edges", i, "sourceHandle"], 'A condition edge must use the "true" or "false" handle');
                }
                if (!isCondition && edge.sourceHandle !== null) {
                    problem(["edges", i, "sourceHandle"], "Only condition nodes have true/false handles");
                }
            }

            const key = `${edge.source}|${edge.sourceHandle}|${edge.target}`;
            if (edgeKeys.has(key)) problem(["edges", i], "Duplicate connection");
            edgeKeys.add(key);
        });
    });
