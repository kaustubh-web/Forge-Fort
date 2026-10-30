import { useState } from "react";
import { Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// The textarea text -> { input } or { problem }. Empty means "no input".
// The server checks again (schema/execution.js); this only gives a faster, clearer message.
function parseInput(text) {
  if (!text.trim()) return { input: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { problem: `Not valid JSON: ${err.message}` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { problem: 'Input must be a JSON object, for example {"todoId": 1}' };
  }
  return { input: value };
}

// Asks for the trigger input, then calls onRun(input).
// The editor mounts this only while it is open, so every open starts fresh from initialInput.
export default function RunDialog({ initialInput, onRun, onClose }) {
  const [text, setText] = useState(() => JSON.stringify(initialInput ?? {}, null, 2));
  const [problem, setProblem] = useState(null);
  const [starting, setStarting] = useState(false);

  async function submit() {
    const parsed = parseInput(text);
    if (parsed.problem) {
      setProblem(parsed.problem);
      return;
    }
    setStarting(true);
    try {
      await onRun(parsed.input); // the editor saves if needed, starts the run and closes this dialog
    } catch {
      setStarting(false); // the editor already showed the error; stay open so it can be fixed
    }
  }

  // Ctrl+Enter inside the textarea runs, so the keyboard never has to leave it.
  function onKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  return (
    // Closing (Esc, clicking outside, the X) is ignored while the run is starting.
    <Dialog open onOpenChange={(open) => !open && !starting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run workflow</DialogTitle>
          <DialogDescription>
            Trigger input as JSON. Nodes read it with <code className="font-mono">{"{{input.field}}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
          aria-invalid={!!problem}
          className="max-h-80 min-h-32 font-mono text-xs"
        />
        {problem && <p className="text-xs text-status-failed">{problem}</p>}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">Ctrl+Enter to run</span>
          <Button variant="outline" size="sm" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={starting}>
            <Play /> {starting ? "Starting..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
