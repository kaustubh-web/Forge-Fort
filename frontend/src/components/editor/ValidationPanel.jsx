import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Floats over the top-left of the canvas. `issues` comes from validateGraph();
// clicking an issue calls onSelect(nodeId) so the editor can select that node.
export default function ValidationPanel({ issues, onSelect }) {
  const [open, setOpen] = useState(false);

  if (issues.length === 0) {
    return (
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-status-success" />
        Ready to run
      </div>
    );
  }

  return (
    <div className="absolute left-3 top-3 z-10 w-72 rounded-lg border bg-card text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5"
        onClick={() => setOpen(!open)}
      >
        <AlertTriangle className="size-3.5 text-status-failed" />
        <span className="flex-1 text-left">
          {issues.length} issue{issues.length > 1 ? "s" : ""} to fix before running
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul className="max-h-48 overflow-auto border-t">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!issue.nodeId} // graph-level issues (no trigger) belong to no node
                onClick={() => onSelect(issue.nodeId)}
                className="w-full px-2 py-1.5 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
