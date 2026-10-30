import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { nodeTypes } from "@/lib/nodeTypes";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

// Node and run statuses -> text colour (design tokens).
const STATUS_TEXT = {
  idle: "text-muted-foreground",
  running: "text-status-running",
  success: "text-status-success",
  failed: "text-status-failed",
  skipped: "text-status-skipped",
  completed: "text-status-success",
  cancelled: "text-status-skipped",
};

// Pretty-printed JSON with a copy button. The server already redacted secrets.
function JsonBlock({ title, value }) {
  const text = JSON.stringify(value ?? null, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${title} copied`);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center justify-between text-muted-foreground">
        <span>{title}</span>
        <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={`Copy ${title}`}>
          <Copy />
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto rounded-md border bg-background p-2">{text}</pre>
    </div>
  );
}

// One node, in run order. Click to see its earlier attempts, input and output.
function NodeRow({ index, record }) {
  const [open, setOpen] = useState(false);
  const Icon = nodeTypes[record.type]?.icon;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-muted/50"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="w-5 shrink-0 text-muted-foreground">{index + 1}</span>
        {Icon && <Icon className="size-3.5 shrink-0" />}
        <span className="truncate">{record.label || record.nodeId}</span>
        <span className={cn("ml-auto shrink-0", STATUS_TEXT[record.status])}>{record.status}</span>
        <span className="w-16 shrink-0 text-right text-muted-foreground">{formatDuration(record.durationMs)}</span>
        <span className="w-20 shrink-0 text-right text-muted-foreground">
          {record.attempts > 1 ? `${record.attempts} attempts` : ""}
        </span>
      </button>

      {/* Why a node did not run or failed is visible without expanding. */}
      {record.skipReason && <p className="px-3 pb-2 pl-14 text-muted-foreground">Skipped: {record.skipReason}</p>}
      {record.error && <p className="px-3 pb-2 pl-14 text-status-failed">{record.error}</p>}

      {open && (
        <div className="space-y-2 px-3 pb-3 pl-14">
          {(record.attemptLog ?? []).map((a) => (
            <p key={a.attempt} className="text-status-failed">
              Attempt {a.attempt} failed: {a.error}
              {a.waitMs != null && ` (retried after ${formatDuration(a.waitMs)})`}
            </p>
          ))}
          <div className="flex gap-3">
            <JsonBlock title="Input" value={record.input} />
            <JsonBlock title="Output" value={record.output} />
          </div>
        </div>
      )}
    </li>
  );
}

// Bottom panel of the editor. `execution` is the state from lib/executionState.js.
export default function ExecutionLogPanel({ execution }) {
  const [open, setOpen] = useState(true);
  const records = execution.order.map((id) => execution.nodes[id]);
  const done = records.filter((r) => r.status !== "idle" && r.status !== "running").length;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="shrink-0 border-t bg-card font-mono text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-8 w-full items-center gap-2 px-3 text-left">
        <Chevron className="size-3.5 text-muted-foreground" />
        <span className="font-sans font-medium">Execution log</span>
        <span className={STATUS_TEXT[execution.status]}>{execution.status}</span>
        <span className="ml-auto text-muted-foreground">
          {done}/{records.length} nodes · {formatDuration(execution.durationMs)}
        </span>
      </button>

      {open && (
        <div className="max-h-72 overflow-auto border-t">
          {execution.error && (
            <p className="border-b px-3 py-2 text-status-failed">
              {execution.error.nodeId && `${execution.error.nodeId}: `}
              {execution.error.message}
            </p>
          )}

          <ol>
            {records.map((record, i) => (
              <NodeRow key={record.nodeId} index={i} record={record} />
            ))}
          </ol>

          {execution.logs.length > 0 && (
            <div className="border-t px-3 py-2">
              <p className="mb-1 font-sans text-muted-foreground">Output messages</p>
              {execution.logs.map((entry, i) => (
                <p key={i}>
                  <span className="text-muted-foreground">{entry.nodeId}</span> {entry.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
