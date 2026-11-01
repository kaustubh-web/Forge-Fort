import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { listAllExecutions } from "@/lib/executionApi";
import { getApiError } from "@/lib/api";
import { formatDuration, timeAgo } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Run status -> dot colour and text colour (design tokens).
const STATUS_STYLE = {
  running: { dot: "bg-status-running animate-pulse", text: "text-status-running" },
  completed: { dot: "bg-status-success", text: "text-status-success" },
  failed: { dot: "bg-status-failed", text: "text-status-failed" },
  cancelled: { dot: "bg-status-skipped", text: "text-muted-foreground" },
};

// null = all. The values are the server's status names (GET /api/executions?status=...).
const FILTERS = [
  { label: "All", value: null },
  { label: "Running", value: "running" },
  { label: "Failed", value: "failed" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

// Every run across all workflows. A row opens the run in its editor (?run=<id>), which loads it
// the same way a page refresh does: snapshot from MongoDB, live stream if it is still running.
export default function Executions() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState(null);
  const [runs, setRuns] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setRuns(null);
    try {
      setRuns(await listAllExecutions(filter));
    } catch (err) {
      setError(getApiError(err).message);
    }
  }, [filter]);

  // Reload whenever the filter changes (load changes with it).
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Executions</h1>
          <p className="text-sm text-muted-foreground">The latest 50 runs across all your workflows.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      <div className="flex gap-1">
        {FILTERS.map(({ label, value }) => (
          <Button
            key={label}
            size="sm"
            variant={filter === value ? "secondary" : "ghost"}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && (
        <div className="text-sm">
          <p className="text-status-failed">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>Try again</Button>
        </div>
      )}

      {!error && !runs && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {runs?.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filter ? `No ${filter} runs.` : "No runs yet. Open a workflow and click Run."}
        </p>
      )}

      {runs?.length > 0 && (
        <div className="rounded-[10px] border">
          <div className="flex h-8 items-center gap-4 border-b px-3 text-xs text-muted-foreground">
            <span className="w-28 shrink-0">Status</span>
            <span className="flex-1">Workflow</span>
            <span className="w-24 shrink-0">Started</span>
            <span className="w-20 shrink-0 text-right">Duration</span>
          </div>
          {runs.map((run) => {
            const style = STATUS_STYLE[run.status] ?? STATUS_STYLE.cancelled;
            return (
              <button
                key={run._id}
                type="button"
                onClick={() => navigate(`/workflows/${run.workflow}?run=${run._id}`)}
                className="flex h-9 w-full items-center gap-4 border-b px-3 text-left text-sm last:border-b-0 hover:bg-muted/50"
              >
                <span className={cn("flex w-28 shrink-0 items-center gap-2 capitalize", style.text)}>
                  <span className={cn("size-2 rounded-full", style.dot)} />
                  {run.status}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="truncate">{run.metadata?.workflowName ?? "Untitled workflow"}</span>
                  {run.error?.message && (
                    <span className="truncate font-mono text-xs text-muted-foreground" title={run.error.message}>
                      {run.error.message}
                    </span>
                  )}
                </span>
                <span className="w-24 shrink-0 text-muted-foreground" title={new Date(run.startedAt).toLocaleString()}>
                  {timeAgo(run.startedAt)}
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {formatDuration(run.durationMs)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
