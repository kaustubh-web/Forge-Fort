// Small builders so engine tests read like the graph they describe.

export const node = (id, type, config = {}) => ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: "", config },
});

export const edge = (source, target, sourceHandle = null) => ({
    id: `${source}-${sourceHandle ?? "out"}-${target}`,
    source,
    target,
    sourceHandle,
});

export const workflow = (nodes, edges) => ({ name: "Test", description: "", nodes, edges });

export const trigger = (id = "trigger") => node(id, "manualTrigger");
export const output = (id, message, data) => node(id, "output", data ? { message, data } : { message });
export const condition = (id, left, operator, right) => node(id, "condition", { left, operator, right });

// Trigger -> Condition -(true)-> A -> Merge -> Output
//                      -(false)-> B -/
// A and B tag the data so the test can see which branch reached Merge.
export function diamond() {
    return workflow(
        [
            trigger(),
            condition("check", "{{input.status}}", "equals", "200"),
            node("a", "transform", { operations: [{ type: "map", params: { path: "items", field: "via", value: "A" } }] }),
            node("b", "transform", { operations: [{ type: "map", params: { path: "items", field: "via", value: "B" } }] }),
            node("merge", "transform", { operations: [{ type: "select", params: { fields: ["items"] } }] }),
            output("out", "Done: {{nodes.merge.output.items.0.via}}"),
        ],
        [
            edge("trigger", "check"),
            edge("check", "a", "true"),
            edge("check", "b", "false"),
            edge("a", "merge"),
            edge("b", "merge"),
            edge("merge", "out"),
        ]
    );
}
