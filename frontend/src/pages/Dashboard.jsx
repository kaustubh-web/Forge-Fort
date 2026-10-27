import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Workflow, MoreHorizontal, Copy, Trash2, ExternalLink } from "lucide-react";
import {
  listWorkflows,
  createWorkflow,
  duplicateWorkflow,
  deleteWorkflow,
} from "@/lib/workflowApi";
import { getApiError } from "@/lib/api";
import { nodeTypes, nextNodeId } from "@/lib/nodeTypes";
import { timeAgo } from "@/lib/time";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function Dashboard() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null); // the workflow awaiting delete confirmation

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkflows(await listWorkflows());
    } catch (err) {
      setError(getApiError(err).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate() {
    setCreating(true);
    try {
      // A new workflow starts with a trigger, because every workflow needs exactly one.
      const workflow = await createWorkflow({
        name: "Untitled workflow",
        description: "",
        nodes: [
          {
            id: nextNodeId("manualTrigger", []),
            type: "manualTrigger",
            position: { x: 80, y: 120 },
            data: { label: nodeTypes.manualTrigger.label, config: {} },
          },
        ],
        edges: [],
      });
      navigate(`/workflows/${workflow._id}`);
    } catch (err) {
      toast.error(getApiError(err).message);
      setCreating(false);
    }
  }

  async function onDuplicate(workflow) {
    try {
      await duplicateWorkflow(workflow._id);
      toast.success("Workflow duplicated");
      load();
    } catch (err) {
      toast.error(getApiError(err).message);
    }
  }

  async function onConfirmDelete() {
    const workflow = toDelete;
    setToDelete(null);
    try {
      await deleteWorkflow(workflow._id);
      setWorkflows((current) => current.filter((w) => w._id !== workflow._id));
      toast.success(`Deleted "${workflow.name}"`);
    } catch (err) {
      toast.error(getApiError(err).message);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">Workflows</h1>
        <Button onClick={onCreate} disabled={creating}>
          <Plus className="size-4" />
          {creating ? "Creating..." : "New workflow"}
        </Button>
      </div>

      <div className="mt-6 rounded-lg border">
        {/* Loading */}
        {workflows === null && !error && (
          <div className="p-3 space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-10 text-center">
            <p className="font-medium">Could not load workflows</p>
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-3" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {/* Empty */}
        {workflows && workflows.length === 0 && (
          <div className="p-10 text-center">
            <Workflow className="size-6 mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">No workflows yet</p>
            <p className="text-muted-foreground">Create one to start building on the canvas.</p>
          </div>
        )}

        {/* List */}
        {workflows &&
          workflows.map((workflow) => (
            <div
              key={workflow._id}
              onClick={() => navigate(`/workflows/${workflow._id}`)}
              className="flex items-center gap-3 h-9 px-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/50"
            >
              <Workflow className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium truncate">{workflow.name}</span>
              <span className="flex-1 truncate text-muted-foreground">{workflow.description}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {timeAgo(workflow.updatedAt)}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Workflow actions"
                  onClick={(e) => e.stopPropagation()}
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                {/* The menu renders in a portal, but React events still bubble to the row,
                    so stop them here too or clicking an item would also open the workflow. */}
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => navigate(`/workflows/${workflow._id}`)}>
                    <ExternalLink className="size-4" /> Open
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(workflow)}>
                    <Copy className="size-4" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setToDelete(workflow)}>
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
      </div>

      {/* Confirm dialog: open whenever toDelete holds a workflow */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
