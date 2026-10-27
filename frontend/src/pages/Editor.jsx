import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReactFlowProvider, useNodesState, useEdgesState } from "@xyflow/react";
import { getWorkflow } from "@/lib/workflowApi";
import { getApiError } from "@/lib/api";
import { toFlowNodes, toFlowEdges } from "@/lib/workflowGraph";
import { Skeleton } from "@/components/ui/skeleton";
import NodePalette from "@/components/editor/NodePalette";
import FlowCanvas from "@/components/editor/FlowCanvas";

// Outer component: only loads the workflow. The editor itself mounts once data exists,
// so its initial state can come straight from the loaded workflow.
export default function Editor() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false; // ignore a late response if we navigated away
    setWorkflow(null);
    setError(null);
    getWorkflow(id)
      .then((data) => !cancelled && setWorkflow(data))
      .catch((err) => !cancelled && setError(getApiError(err).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="p-10 text-center">
        <p className="font-medium">Could not open this workflow</p>
        <p className="text-muted-foreground">{error}</p>
        <Link to="/" className="mt-3 inline-block text-primary hover:underline">
          Back to workflows
        </Link>
      </div>
    );
  }
  if (!workflow) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <EditorInner key={workflow._id} workflow={workflow} />
    </ReactFlowProvider>
  );
}

function EditorInner({ workflow }) {
  // These hooks give us the nodes/edges plus the change handlers React Flow needs
  // (dragging, selecting, deleting all arrive through onNodesChange / onEdgesChange).
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(workflow.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(workflow.edges));

  const hasTrigger = nodes.some((n) => n.type === "manualTrigger");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          Workflows
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium truncate">{workflow.name}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodePalette hasTrigger={hasTrigger} />
        <div className="min-w-0 flex-1">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          />
        </div>
      </div>
    </div>
  );
}
