import { Handle, Position } from "@xyflow/react";
import { nodeTypes } from "@/lib/nodeTypes";
import { cn } from "@/lib/utils";

// Status dot colours come from the design tokens (bg-status-*).
const STATUS_DOT = {
  idle: "bg-muted-foreground/40",
  running: "bg-status-running animate-pulse",
  success: "bg-status-success",
  failed: "bg-status-failed",
  skipped: "bg-status-skipped",
};

// One component renders every node type. React Flow passes: id, type, data, selected.
export default function NodeCard({ type, data, selected }) {
  const def = nodeTypes[type];
  const Icon = def.icon;
  const status = data.status || "idle";
  const isCondition = type === "condition";

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card",
        selected && "border-primary",
        status === "skipped" && "opacity-50"
      )}
    >
      {/* Input handle on the left. The trigger starts the workflow, so it has none. */}
      {type !== "manualTrigger" && <Handle type="target" position={Position.Left} />}

      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{data.label || def.label}</div>
          <div className="truncate text-xs text-muted-foreground">{def.summary(data.config)}</div>
        </div>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />
      </div>

      {isCondition ? (
        // Two labelled outputs. The handle id ("true"/"false") ends up as edge.sourceHandle,
        // which is how the engine later knows which branch an edge belongs to.
        <div className="border-t">
          <div className="relative flex h-6 items-center justify-end px-3 text-xs text-status-success">
            true
            <Handle type="source" position={Position.Right} id="true" />
          </div>
          <div className="relative flex h-6 items-center justify-end px-3 text-xs text-status-failed">
            false
            <Handle type="source" position={Position.Right} id="false" />
          </div>
        </div>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
