import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import NodeCard from "@/components/editor/NodeCard";
import { nodeTypes, nextNodeId, DRAG_TYPE } from "@/lib/nodeTypes";

// Maps each node "type" string to the component that draws it.
// Defined outside the component so the object is the same on every render
// (a new object each render makes React Flow warn and re-create nodes).
const rfNodeTypes = Object.fromEntries(Object.keys(nodeTypes).map((type) => [type, NodeCard]));

export default function FlowCanvas({ nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange }) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef(null);

  // Refit when the canvas gets taller or shorter (the execution log appearing, collapsing or
  // expanding), so the graph is not left half-hidden. Width changes (the config panel opening
  // on every selection) keep the user's view.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === lastHeight) return;
      lastHeight = element.clientHeight;
      fitView({ duration: 200 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitView]);

  // The user dragged from one handle to another.
  const onConnect = useCallback(
    (connection) => {
      const id = `edge-${connection.source}-${connection.sourceHandle ?? "out"}-${connection.target}`;
      // addEdge ignores an exact duplicate of an existing connection.
      setEdges((current) => addEdge({ ...connection, id }, current));
    },
    [setEdges]
  );

  // A node cannot connect to itself.
  const isValidConnection = useCallback((c) => c.source !== c.target, []);

  const onDragOver = useCallback((event) => {
    event.preventDefault(); // without this the browser refuses the drop
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DRAG_TYPE);
      if (!type || !nodeTypes[type]) return;

      if (type === "manualTrigger" && nodes.some((n) => n.type === "manualTrigger")) {
        toast.error("A workflow can have only one trigger");
        return;
      }

      // Screen pixels -> canvas coordinates (accounts for pan and zoom).
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = nextNodeId(type, nodes.map((n) => n.id));
      setNodes((current) =>
        current.concat({
          id,
          type,
          position,
          data: { label: nodeTypes[type].label, config: structuredClone(nodeTypes[type].defaultConfig) },
        })
      );
    },
    [nodes, setNodes, screenToFlowPosition]
  );

  // Ctrl+D duplicates the selected nodes (never the trigger: only one is allowed).
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "d") return;
      if (event.target.closest?.("input, textarea, [contenteditable]")) return;
      event.preventDefault(); // stop the browser's "bookmark this page"

      const selected = nodes.filter((n) => n.selected && n.type !== "manualTrigger");
      if (selected.length === 0) return;

      setNodes((current) => {
        const ids = current.map((n) => n.id);
        const copies = selected.map((n) => {
          const id = nextNodeId(n.type, ids);
          ids.push(id);
          return {
            id,
            type: n.type,
            position: { x: n.position.x + 40, y: n.position.y + 40 },
            selected: true,
            data: structuredClone(n.data),
          };
        });
        // Deselect the originals so only the copies are selected.
        return [...current.map((n) => ({ ...n, selected: false })), ...copies];
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodes, setNodes]);

  return (
    <ReactFlow
      ref={canvasRef}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={rfNodeTypes}
      deleteKeyCode={["Delete", "Backspace"]}
      colorMode="dark"
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
