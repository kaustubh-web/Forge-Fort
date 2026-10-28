import { describe, it, expect } from "vitest";
import { buildGraph, topologicalSort, reachableFrom, ancestorsOf } from "../../src/engine/graph.js";

const nodes = (...ids) => ids.map((id) => ({ id }));
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

describe("topologicalSort (Kahn)", () => {
    it("orders a linear chain", () => {
        const graph = buildGraph(nodes("a", "b", "c"), [edge("a", "b"), edge("b", "c")]);
        expect(topologicalSort(graph)).toEqual({ order: ["a", "b", "c"], cyclic: [] });
    });

    it("puts a converging node after all of its parents (diamond)", () => {
        // a -> b -> d, a -> c -> d. Plain BFS from a could reach d via b before c ran.
        const graph = buildGraph(nodes("a", "b", "c", "d"), [
            edge("a", "b"),
            edge("a", "c"),
            edge("b", "d"),
            edge("c", "d"),
        ]);
        const { order } = topologicalSort(graph);
        expect(order).toEqual(["a", "b", "c", "d"]);
    });

    it("handles a long branch converging with a short one", () => {
        // a -> b -> c -> d and a -> d: d must still come last
        const graph = buildGraph(nodes("a", "d", "b", "c"), [
            edge("a", "d"),
            edge("a", "b"),
            edge("b", "c"),
            edge("c", "d"),
        ]);
        expect(topologicalSort(graph).order).toEqual(["a", "b", "c", "d"]);
    });

    it("is deterministic (node order, then edge order)", () => {
        const graph = buildGraph(nodes("t", "x", "y"), [edge("t", "y"), edge("t", "x")]);
        expect(topologicalSort(graph).order).toEqual(["t", "y", "x"]);
    });

    it("reports nodes on a cycle and nodes behind it", () => {
        // a -> b -> c -> b, c -> d
        const graph = buildGraph(nodes("a", "b", "c", "d"), [
            edge("a", "b"),
            edge("b", "c"),
            edge("c", "b"),
            edge("c", "d"),
        ]);
        const { order, cyclic } = topologicalSort(graph);
        expect(order).toEqual(["a"]);
        expect(cyclic).toEqual(["b", "c", "d"]);
    });
});

describe("reachableFrom / ancestorsOf", () => {
    const graph = buildGraph(nodes("a", "b", "c", "lonely"), [edge("a", "b"), edge("b", "c")]);

    it("finds everything the start node can reach", () => {
        expect([...reachableFrom(graph, "a")].sort()).toEqual(["a", "b", "c"]);
    });

    it("finds all ancestors, not just direct parents", () => {
        expect([...ancestorsOf(graph, "c")].sort()).toEqual(["a", "b"]);
        expect(ancestorsOf(graph, "lonely").size).toBe(0);
    });
});
