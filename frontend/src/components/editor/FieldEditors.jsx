import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRANSFORM_OPERATIONS } from "@/lib/nodeTypes";

// Small editors for the "complex" field kinds in nodeTypes.js.
// They are all controlled: the parent passes `value`, and we call onChange(newValue)
// with a NEW array/object (never mutate the old one, React would not notice).

export function SelectField({ value, options, onChange }) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// value: [{ key, value }, ...]  (query params, headers, output data)
export function KeyValueEditor({ value = [], onChange }) {
  const update = (i, patch) => onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const remove = (i) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="space-y-1.5">
      {value.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <Input placeholder="key" value={row.key} onChange={(e) => update(i, { key: e.target.value })} />
          <Input placeholder="value" value={row.value} onChange={(e) => update(i, { value: e.target.value })} />
          <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove row">
            <X />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { key: "", value: "" }])}>
        <Plus /> Add
      </Button>
    </div>
  );
}

// value: ["a", "b", ...]  (categories, fields to keep)
export function ListEditor({ value = [], onChange }) {
  const update = (i, text) => onChange(value.map((item, j) => (j === i ? text : item)));
  const remove = (i) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={item} onChange={(e) => update(i, e.target.value)} />
          <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove item">
            <X />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
        <Plus /> Add
      </Button>
    </div>
  );
}

// value: undefined (no retry) or { maxAttempts, backoffMs }. The server allows 1-5 attempts.
export function RetryEditor({ value, onChange }) {
  if (!value) {
    return (
      <Button variant="outline" size="sm" onClick={() => onChange({ maxAttempts: 3, backoffMs: 1000 })}>
        Enable retry
      </Button>
    );
  }
  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || min));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Max attempts (1-5)</Label>
          <Input
            type="number"
            value={value.maxAttempts}
            onChange={(e) => onChange({ ...value, maxAttempts: clamp(e.target.value, 1, 5) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Backoff (ms)</Label>
          <Input
            type="number"
            value={value.backoffMs}
            onChange={(e) => onChange({ ...value, backoffMs: clamp(e.target.value, 0, 60000) })}
          />
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
        Remove retry
      </Button>
    </div>
  );
}

// value: [{ type, params }, ...]  Which params each type has comes from TRANSFORM_OPERATIONS.
export function OperationsEditor({ value = [], onChange }) {
  const update = (i, op) => onChange(value.map((current, j) => (j === i ? op : current)));
  const remove = (i) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {value.map((op, i) => {
        const def = TRANSFORM_OPERATIONS[op.type];
        const setParam = (name, v) => update(i, { ...op, params: { ...op.params, [name]: v } });
        return (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <div className="flex gap-1.5">
              {/* Changing the type starts with empty params: the old ones belonged to another type. */}
              <SelectField
                value={op.type}
                options={Object.keys(TRANSFORM_OPERATIONS)}
                onChange={(type) => update(i, { type, params: {} })}
              />
              <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove operation">
                <X />
              </Button>
            </div>
            {def.params.map((param) => (
              <div key={param.name} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{param.label}</Label>
                {param.kind === "list" ? (
                  <ListEditor value={op.params[param.name]} onChange={(v) => setParam(param.name, v)} />
                ) : param.kind === "select" ? (
                  <SelectField
                    value={op.params[param.name]}
                    options={param.options}
                    onChange={(v) => setParam(param.name, v)}
                  />
                ) : (
                  <Input
                    value={op.params[param.name] ?? ""}
                    onChange={(e) => setParam(param.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { type: "select", params: {} }])}>
        <Plus /> Add operation
      </Button>
    </div>
  );
}
