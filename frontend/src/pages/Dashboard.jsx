import { Workflow } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Workflows</h1>

      {/* Empty state: the editor and workflow list arrive in Phase 2 */}
      <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
        <Workflow className="size-6 mx-auto text-muted-foreground" />
        <p className="mt-3 font-medium">No workflows yet</p>
        <p className="text-muted-foreground">Workflows you create will appear here.</p>
      </div>
    </div>
  );
}
