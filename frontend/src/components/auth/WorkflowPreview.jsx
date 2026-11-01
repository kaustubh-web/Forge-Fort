import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import NodeCard from "@/components/editor/NodeCard";
import { nodeTypes } from "@/lib/nodeTypes";
import { nodeStatuses, executedEdgeIds } from "@/lib/executionState";
import { DEMO_NODES, DEMO_EDGES, DEMO_LENGTH_MS, demoStateAt } from "@/lib/demoRun";
import { cn } from "@/lib/utils";

const rfNodeTypes = Object.fromEntries(Object.keys(nodeTypes).map((type) => [type, NodeCard]));
const TICK_MS = 100;
const LOG_ROWS = 6; // fixed height, so the page does not jump as lines arrive

const STATUS_TEXT = {
  running: "text-status-running",
  success: "text-status-success",
  failed: "text-status-failed",
  skipped: "text-muted-foreground",
  completed: "text-status-success",
};

// A read-only canvas replaying a scripted run (lib/demoRun.js): the same NodeCard, status dots,
// executed-path edges and log format as the editor. With "reduce motion" on, it shows the
// finished run and never animates.
export default function WorkflowPreview() {
  const [still] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [elapsed, setElapsed] = useState(still ? DEMO_LENGTH_MS - 1 : 0);

  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setElapsed((ms) => (ms + TICK_MS) % DEMO_LENGTH_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [still]);

  const state = demoStateAt(elapsed);

  const nodes = useMemo(() => {
    const statuses = nodeStatuses(state);
    return DEMO_NODES.map((n) => ({ ...n, data: { ...n.data, status: statuses[n.id] } }));
    // Recompute only when a status changes, not on every 100 ms tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(nodeStatuses(state))]);

  const executed = executedEdgeIds(state, DEMO_EDGES);
  const edges = DEMO_EDGES.map((e) =>
    executed.has(e.id) ? { ...e, animated: !still, style: { stroke: "var(--status-success)", strokeWidth: 2 } } : e
  );

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex h-9 items-center justify-between border-b px-3 text-xs">
        <span className="text-muted-foreground">
          Trip weather advisor <span className="font-mono">{'{"city": "Mumbai"}'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              state.status === "running" ? "bg-status-running animate-pulse" : "bg-status-success"
            )}
          />
          {state.status === "running" ? "Running" : "Completed"}
        </span>
      </div>

      <div className="h-56" aria-hidden="true">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={rfNodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>
      </div>

      <ol className="border-t px-3 py-2 font-mono text-xs" style={{ height: `${LOG_ROWS * 20 + 16}px` }}>
        {state.log.slice(-LOG_ROWS).map((line) => (
          <li key={line.text} className="flex h-5 items-center gap-3">
            <span className="w-24 shrink-0 text-muted-foreground">{line.nodeId ?? "workflow"}</span>
            <span className={cn("w-16 shrink-0", STATUS_TEXT[line.status])}>{line.status}</span>
            <span className="truncate text-muted-foreground">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
