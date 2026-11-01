import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { History, Play, Save, Square } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useExecution } from "@/hooks/useExecution";
import { listExecutions } from "@/lib/executionApi";
import { nodeStatuses, executedEdgeIds } from "@/lib/executionState";
import RunDialog from "@/components/editor/RunDialog";
import ExecutionLogPanel from "@/components/editor/ExecutionLogPanel";
import RunHistoryDialog from "@/components/editor/RunHistoryDialog";

// Execution status -> badge dot colour and label (design tokens, see index.css).
const RUN_STATUS = {
  running: {dot: "bg-status-running animate-pulse",label:"Running"},
  completed: {dot:"bg-status-success", label: "Completed"},
  failed:{dot: "bg-status-failed", label:"Failed"},
  cancelled: {dot:"bg-status-skipped", label:"Cancelled"},
};


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

  // Running. ?run=<executionId> in the URL keeps the current run across a page refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const { execution, connection, error: streamError, start, stop, load } = useExecution();
  const [runOpen, setRunOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const running = execution?.status === "running";

  // Run status is display-only: build copies for the canvas instead of changing `nodes`,
  // so a run never marks the workflow dirty or ends up in the saved JSON.
  const displayNodes = useMemo(() => {
    const statuses = nodeStatuses(execution);
    return nodes.map((n) => (statuses[n.id] ? { ...n, data: { ...n.data, status: statuses[n.id] } } : n));
  }, [nodes, execution]);

  // Edges the run actually travelled are animated and green (only the taken Condition branch).
  const displayEdges = useMemo(() => {
    const executed = executedEdgeIds(execution, edges);
    return edges.map((e) =>
      executed.has(e.id) ? { ...e, animated: true, style: { stroke: "var(--status-success)", strokeWidth: 2 } } : e
    );
  }, [edges, execution]);

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

  // Returns true when the server has the current canvas (saved now, or nothing to save).
  async function save() {
    if (!dirty) return true;
    if (saving || !name.trim()) return false;
    setSaving(true);
    try {
      await updateWorkflow(workflow._id, payload);
      setSavedSnapshot(snapshot); // the version we sent, not whatever the canvas looks like now
      toast.success("Saved");
      return true;
    } catch (err) {
      toast.error(getApiError(err).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Called by the Run dialog. The server runs the SAVED workflow, so save unsaved edits first.
  // Throwing keeps the dialog open (RunDialog catches it).
  async function runWorkflow(input) {
    if (!(await save())) throw new Error("not saved");
    try {
      const executionId = await start(workflow._id, input);
      setSearchParams({ run: executionId }, { replace: true });
      setRunOpen(false);
    } catch (err) {
      // 400 INVALID_WORKFLOW lists the problems in details; show the first one.
      const { message, details } = getApiError(err);
      toast.error(details?.length ? `${message}: ${details[0].message}` : message);
      throw err;
    }
  }

  async function stopRun() {
    try {
      await stop();
    } catch (err) {
      toast.error(getApiError(err).message); // e.g. 409 "Execution is already completed"
    }
  }
  function openRun(executionId){
    setSearchParams({run: executionId},{replace:true});
    load(executionId);
    setHistoryOpen(false);
  }

  // After a refresh (or opening a shared link), pick up the run named in the URL.
  // Without ?run= (opened from the dashboard), attach to a run of this workflow that is still
  // going, so the canvas shows it and Stop works. Runs once on mount: later ?run= changes come
  // from runWorkflow and openRun, which already connected.
  useEffect(() => {
    const runId = searchParams.get("run");
    if(runId){
      load(runId);
      return;
    }
    listExecutions(workflow._id)
       .then((runs)=>{
        const live = runs.find((run)=>run.status === "running"); // newest first
        if(live){
          setSearchParams({ run: live._id},{replace: true});
          load(live._id);
        }
       })
       .catch(()=>{}); // a convenience only: the editor works without it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One toast when a run we watched live finishes. A finished run loaded from the URL is not
  // announced, because its status never was "running" here.
  const lastStatus = useRef(null);
  useEffect(() => {
    const status = execution?.status ?? null;
    if (lastStatus.current === "running" && status && status !== "running") {
      if (status === "completed") toast.success("Run completed");
      else if (status === "failed") toast.error(`Run failed: ${execution.error?.message ?? "see the log"}`);
      else toast("Run cancelled");
    }
    lastStatus.current = status;
  }, [execution]);

  // Ctrl+S saves, Ctrl+Enter opens the Run dialog. Re-subscribed after every render so the
  // handler always sees the latest state.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); // stop the browser's "save page" dialog
        save();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !runOpen && !running && hasTrigger) {
        event.preventDefault();
        setRunOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, runOpen, running, hasTrigger]);

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
          {execution && (
            <span className="flex items-center gap-1.5 text-xs" title={streamError ?? undefined}>
              <span className={cn("size-2 rounded-full", RUN_STATUS[execution.status]?.dot)} />
              {RUN_STATUS[execution.status]?.label}
              {connection === "reconnecting" && <span className="text-muted-foreground">(reconnecting...)</span>}
              {connection === "error" && <span className="text-status-failed">(live updates lost)</span>}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {saving ? "Saving..." : dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History /> History
          </Button>
          {/* Disabled buttons do not show tooltips, so the title goes on a wrapping span. */}
          <span title={hasTrigger ? "Run (Ctrl+Enter)" : "Add a Manual Trigger first"}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRunOpen(true)}
              disabled={running || !hasTrigger || !name.trim()}
            >
              <Play /> Run
            </Button>
          </span>
          <Button variant="outline" size="sm" onClick={stopRun} disabled={!running}>
            <Square /> Stop
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving || !name.trim()}>
            <Save /> Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodePalette hasTrigger={hasTrigger} />
        <div className="relative min-w-0 flex-1">
          <FlowCanvas
            nodes={displayNodes}
            edges={displayEdges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          />
          <ValidationPanel issues={issues} onSelect={selectNode} />
        </div>
        {selected && <ConfigPanel key={selected.id} node={selected} onChange={updateNodeData} />}
      </div>
      {execution && <ExecutionLogPanel execution={execution} />}

      {runOpen && (
        <RunDialog initialInput={execution?.input} onRun={runWorkflow} onClose={() => setRunOpen(false)} />
      )}
      
      {historyOpen &&(
        <RunHistoryDialog 
          workflowId={workflow._id}
          currentId={execution?.executionId}
          running={running}
          onOpenRun={openRun}
          onRerun={runWorkflow}
          onClose={()=> setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

