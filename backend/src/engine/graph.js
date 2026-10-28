// Graph helpers used by validation and by the execute loop.
// A workflow is a directed graph: nodes are steps, edges say "source runs before target".

// Index the edges once so every lookup afterwards is a Map get instead of a scan.
export function buildGraph(nodes, edges) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map(nodes.map((node) => [node.id, []]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
        // Edges to unknown nodes are rejected by the schema; skip them here so helpers never crash.
        if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
        outgoing.get(edge.source).push(edge);
        incoming.get(edge.target).push(edge);
    }
    return { nodeById, incoming, outgoing };
}

// Kahn's algorithm: topological order + cycle detection in one pass.
//   1. in-degree = number of incoming edges per node
//   2. queue every node with in-degree 0
//   3. pop a node, append it to the order, decrement each child's in-degree;
//      a child that reaches 0 has all parents ordered, so it joins the queue
//   4. nodes never ordered are on a cycle (or behind one): their in-degree never hit 0
// Why not plain BFS: when branches converge, BFS can visit a node before all of its parents.
// Kahn only releases a node after its last parent, which is what execution needs.
// The queue starts in node-array order and children follow edge order, so the result is
// deterministic: the same workflow always runs in the same order.
export function topologicalSort(graph) {
    const inDegree = new Map();
    for (const [id, edges] of graph.incoming) inDegree.set(id, edges.length);

    const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id);
    const order = [];
    while (queue.length) {
        const id = queue.shift();
        order.push(id);
        for (const edge of graph.outgoing.get(id)) {
            const remaining = inDegree.get(edge.target) - 1;
            inDegree.set(edge.target, remaining);
            if (remaining === 0) queue.push(edge.target);
        }
    }

    const ordered = new Set(order);
    const cyclic = [...graph.nodeById.keys()].filter((id) => !ordered.has(id));
    return { order, cyclic };
}

// BFS for reachability only ("can the trigger reach this node?"), never for run order.
export function reachableFrom(graph, startId) {
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
        const id = queue.shift();
        for (const edge of graph.outgoing.get(id) ?? []) {
            if (!seen.has(edge.target)) {
                seen.add(edge.target);
                queue.push(edge.target);
            }
        }
    }
    return seen;
}

// Every node that can reach nodeId (BFS backwards). An expression may only read the output of
// an ancestor: anything else has not run yet when this node runs.
export function ancestorsOf(graph, nodeId) {
    const seen = new Set();
    const queue = [nodeId];
    while (queue.length) {
        const id = queue.shift();
        for (const edge of graph.incoming.get(id) ?? []) {
            if (!seen.has(edge.source)) {
                seen.add(edge.source);
                queue.push(edge.source);
            }
        }
    }
    return seen;
}
