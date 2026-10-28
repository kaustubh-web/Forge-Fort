import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Play, Save, Square } from "lucide-react";
import { toast } from "sonner";
import { ReactFlowProvider, useNodesState, useEdgesState } from "@xyflow/react";
import { getWorkflow, updateWorkflow } from "@/lib/workflowApi";
import { getApiError } from "@/lib/api";
import { toFlowNodes, toFlowEdges, toWorkflowJson } from "@/lib/workflowGraph";
import { validateGraph } from "@/lib/graphValidation";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import NodePalette from "@/components/editor/NodePalette";
import FlowCanvas from "@/components/editor/FlowCanvas";
import ConfigPanel from "@/components/editor/ConfigPanel";
import ValidationPanel from "@/components/editor/ValidationPanel";


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
  const [name, setName] = useState(workflow.name);
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(workflow.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(workflow.edges));
  const [saving, setSaving] = useState(false);

  // Dirty tracking: turn the canvas into the exact JSON we would save, as a string.
  // savedSnapshot is what the server has. If they differ, there are unsaved changes.
  // Comparing JSON (not React Flow state) means selecting or dragging back to the same spot is not "dirty".
  const payload = toWorkflowJson({ name, description: workflow.description, nodes, edges });
  const snapshot = JSON.stringify(payload);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot); // first render = just loaded = saved
  const dirty = snapshot !== savedSnapshot;

  const hasTrigger = nodes.some((n) => n.type === "manualTrigger");
  const issues = validateGraph(nodes, edges);
  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null; // config panel: exactly one node

  // Merge a patch into one node's data (used by the config panel).
  function updateNodeData(id, patch) {
    setNodes((current) => current.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }

  // Select exactly one node (used when clicking an issue in the validation panel).
  function selectNode(id) {
    setNodes((current) => current.map((n) => ({ ...n, selected: n.id === id })));
  }

  async function save() {
    if (!dirty || saving || !name.trim()) return;
    setSaving(true);
    try {
      await updateWorkflow(workflow._id, payload);
      setSavedSnapshot(snapshot); // the version we sent, not whatever the canvas looks like now
      toast.success("Saved");
    } catch (err) {
      toast.error(getApiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S. Re-subscribed after every render so save() always sees the latest state.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); // stop the browser's "save page" dialog
        save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  // Warn before closing or reloading the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          Workflows
        </Link>
        <span className="text-muted-foreground">/</span>
        {/* Looks like text until hovered or focused: the inline-editable name. */}
        <Input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setName("Untitled workflow")}
          className="h-7 w-56 border-transparent bg-transparent px-1.5 font-medium hover:border-input"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {saving ? "Saving..." : dirty ? "Unsaved changes" : "Saved"}
          </span>
          {/* Run and Stop need the engine (Phase 3-5). Disabled buttons do not show tooltips, so title goes on the span. */}
          <span title="Running workflows arrives in a later phase">
            <Button variant="outline" size="sm" disabled>
              <Play /> Run
            </Button>
          </span>
          <span title="Nothing is running">
            <Button variant="outline" size="sm" disabled>
              <Square /> Stop
            </Button>
          </span>
          <Button size="sm" onClick={save} disabled={!dirty || saving || !name.trim()}>
            <Save /> Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodePalette hasTrigger={hasTrigger} />
        <div className="relative min-w-0 flex-1">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          />
          <ValidationPanel issues={issues} onSelect={selectNode} />
        </div>
        {selected && <ConfigPanel key={selected.id} node={selected} onChange={updateNodeData} />}
      </div>
    </div>
  );
}

