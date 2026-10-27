import { nodeTypes, NODE_TYPE_LIST, DRAG_TYPE } from "@/lib/nodeTypes";
import { cn } from "@/lib/utils";

export default function NodePalette({ hasTrigger }) {
  // Drag and drop uses the browser's own API: we store the node type in the drag data,
  // and FlowCanvas reads it back in its onDrop handler.
  function onDragStart(event, type) {
    event.dataTransfer.setData(DRAG_TYPE, type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="w-52 shrink-0 border-r bg-card overflow-auto">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">Nodes</div>
      <div className="px-2 pb-2 space-y-1">
        {NODE_TYPE_LIST.map((type) => {
          const def = nodeTypes[type];
          const Icon = def.icon;
          // A workflow has exactly one trigger, so once it exists the palette entry is disabled.
          const disabled = type === "manualTrigger" && hasTrigger;
          return (
            <div
              key={type}
              draggable={!disabled}
              onDragStart={(e) => onDragStart(e, type)}
              title={disabled ? "A workflow can have only one trigger" : def.description}
              className={cn(
                "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5",
                disabled ? "opacity-40 cursor-not-allowed" : "cursor-grab hover:bg-muted"
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{def.label}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
