import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import {
  listSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  secretNameProblem,
  secretExpression,
} from "@/lib/secretApi";
import { getApiError } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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

// Secrets: encrypted on the server, used in HTTP Request nodes as {{secrets.NAME}}.
// The server never returns a value, so this page can only add, replace and delete.
export default function Settings() {
  const [secrets, setSecrets] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [toReplace, setToReplace] = useState(null); // name whose value is being replaced
  const [toDelete, setToDelete] = useState(null); // name awaiting delete confirmation

  const load = useCallback(async () => {
    setError(null);
    try {
      setSecrets(await listSecrets());
    } catch (err) {
      setError(getApiError(err).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameProblem = name ? secretNameProblem(name) : null; // no complaint while still empty

  async function onAdd(event) {
    event.preventDefault();
    if (secretNameProblem(name) || !value) return;
    setSaving(true);
    try {
      await createSecret(name, value);
      setName("");
      setValue(""); // do not keep the secret in the form after saving
      toast.success(`Saved ${name}`);
      await load();
    } catch (err) {
      toast.error(getApiError(err).message); // e.g. 409 "A secret named X already exists"
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    // AlertDialogAction is a plain Button here (it does not close the dialog), so close it
    // ourselves first, like Dashboard does. Otherwise the dialog stays open after the delete.
    const secretName = toDelete;
    setToDelete(null);
    try {
      await deleteSecret(secretName);
      toast.success(`Deleted ${secretName}`);
      await load();
    } catch (err) {
      toast.error(getApiError(err).message);
    }
  }

  async function copyExpression(secretName) {
    try {
      await navigator.clipboard.writeText(secretExpression(secretName));
      toast.success(`Copied ${secretExpression(secretName)}`);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account-wide settings for your workflows.</p>
      </div>

      <section className="space-y-4 rounded-[10px] border bg-card p-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" /> Secrets
          </h2>
          <p className="text-sm text-muted-foreground">
            API keys and tokens, encrypted on the server. Use one in an HTTP Request header or query as{" "}
            <code className="font-mono text-xs">{"{{secrets.NAME}}"}</code>. A saved value can never be shown again.
          </p>
        </div>

        {/* Add form. autoComplete="off" so the browser does not offer to remember the value. */}
        <form onSubmit={onAdd} autoComplete="off" className="flex items-start gap-2">
          <div className="w-56 space-y-1">
            <Label htmlFor="secret-name" className="text-xs">Name</Label>
            <Input
              id="secret-name"
              value={name}
              placeholder="GITHUB_TOKEN"
              onChange={(e) => setName(e.target.value.toUpperCase())}
              aria-invalid={!!nameProblem}
              className="font-mono"
            />
            {nameProblem && <p className="text-xs text-status-failed">{nameProblem}</p>}
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="secret-value" className="text-xs">Value</Label>
            <Input
              id="secret-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={4096}
            />
          </div>
          <Button type="submit" className="mt-5" disabled={saving || !name || !!nameProblem || !value}>
            {saving ? "Saving..." : "Add secret"}
          </Button>
        </form>

        {error && (
          <div className="text-sm">
            <p className="text-status-failed">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={load}>Try again</Button>
          </div>
        )}

        {!error && !secrets && (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {secrets?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No secrets yet. Add one above.</p>
        )}

        {secrets?.length > 0 && (
          <ul className="rounded-md border">
            {secrets.map((secret) => (
              <li key={secret.name} className="flex h-9 items-center gap-3 border-b px-3 text-sm last:border-b-0">
                <span className="font-mono">{secret.name}</span>
                <span className="text-xs text-muted-foreground">updated {timeAgo(secret.updatedAt)}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon-xs" title="Copy the expression" onClick={() => copyExpression(secret.name)}>
                    <Copy />
                  </Button>
                  <Button variant="ghost" size="icon-xs" title="Replace the value" onClick={() => setToReplace(secret.name)}>
                    <RefreshCw />
                  </Button>
                  <Button variant="ghost" size="icon-xs" title="Delete" onClick={() => setToDelete(secret.name)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toReplace && <ReplaceDialog name={toReplace} onDone={load} onClose={() => setToReplace(null)} />}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              Workflows that use {toDelete && secretExpression(toDelete)} will fail to run until a secret with
              this name exists again. This cannot be undone.
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

// Rotation: same name, new value. Mounted only while open, so it always starts empty.
function ReplaceDialog({ name, onDone, onClose }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSave(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateSecret(name, value);
      toast.success(`Replaced ${name}`);
      onClose();
      await onDone();
    } catch (err) {
      toast.error(getApiError(err).message);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSave} autoComplete="off" className="space-y-4">
          <DialogHeader>
            <DialogTitle>Replace {name}</DialogTitle>
            <DialogDescription>Workflows keep using {secretExpression(name)}; the next run gets the new value.</DialogDescription>
          </DialogHeader>
          <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} maxLength={4096} autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !value}>{saving ? "Saving..." : "Replace"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
