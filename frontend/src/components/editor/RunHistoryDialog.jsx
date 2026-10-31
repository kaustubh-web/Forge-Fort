import { useEffect, useState} from "react";
import { Play } from "lucide-react";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listExecutions } from "@/lib/executionApi";
import { getApiError } from "@/lib/api";
import { formatDuration, timeAgo } from "@/lib/time";
import {cn} from "@/lib/utils";

const STATUS_DOT = {
    running: "bg-status-running animate-pulse",
    completed: "bg-status-success",
    failed: "bg-status-failed",
    cancelled: "bg-status-skipped",
};

export default function RunHistoryDialog({workflowId, currentId, running,onOpenRun, onRerun, onClose}){
    const [runs, setRuns] = useState(null);
    const [error, setError] = useState(null);
    const [rerunning, setRerunning] = useState(false);


    useEffect(()=>{
        let cancelled = false;
        listExecutions(workflowId)
        .then((data) => !cancelled && setRuns(data))
        .catch((err)=> !cancelled && setError(getApiError(err).message));
        return()=>{
            cancelled = true;
        };
    },[workflowId]);


    async function rerun(run){
        setRerunning(true);
        try {
            await onRerun(run.input);
            onClose();
        } catch{
           setRerunning(false); 
        }
    }

    return(
        <Dialog open onOpenChange={(open)=> !open && !rerunning && onClose()}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Run history</DialogTitle>
                    <DialogDescription>The last 50 runs of this workflow, newest first.</DialogDescription>
                </DialogHeader>

                {error && <p className="text-sm text-status-failed">{error}</p>}
                 
                {!error && !runs && (
                    <div className="space-y-2">
                        <Skeleton className="h-9 w-full"/>
                        <Skeleton className="h-9 w-full"/>
                        <Skeleton className="h-9 w-full"/>
                    </div>
                )}

                {runs?.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">No runs yet. Click Run to start one.</p>
                )}

                {runs?.length >0 && (
                    <ul className="max-h-96 overflow-auto rounded-md border">
                        {runs.map((run)=>(
                            <li
                             key={run._id}
                             className={cn(
                                "flex h-9 items-center gap-3 border-b px-3 text-xs last:border-b-0",
                                 run._id === currentId && "bg-muted/50"
                             )} 
                            >
                                <span className={cn("size-2 shrink-0 rounded-full",STATUS_DOT[run.status])} />
                                <button
                                   type="button"
                                   onClick={()=> onOpenRun(run._id)}
                                   title={new Date(run.startedAt).toLocaleString()}
                                   className="flex min-w-0 flex-1 items-center gap-3 text-left hover:underline"
                                >
                                    <span className="w-20 shrink-0 capitalize">{run.status}</span>
                                    <span className="w-20 shrink-0 text-muted-foreground">{timeAgo(run.startedAt)}</span>
                                    <span className="w-16 shrink-0 text-muted-foreground">{formatDuration(run.durationMs)}</span>
                                    <span className="truncate font-mono text-muted-foreground">{JSON.stringify(run.input)}</span>
                                </button>
                                <Button variant="ghost" size="xs" onClick={()=> rerun(run)} disabled={rerunning || running}>
                                    <Play/> Rerun
                                </Button>
                            </li>
                            
                        ))}
                    </ul>
                )}   
            </DialogContent>
        </Dialog>
    );
}
