import { useReactFlow } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { nodeTypes } from "@/lib/nodeTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SelectField,
  KeyValueEditor,
  ListEditor,
  RetryEditor,
  OperationsEditor,
} from "@/components/editor/FieldEditors";

// Draws the right control for one field. `field.kind` comes from nodeTypes.js.
function FieldInput({ field, value, onChange }) {
  switch (field.kind) {
    case "text":
      return <Input value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "textarea":
      return (
        <Textarea
          rows={4}
          className="font-mono"
          value={value ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      // Empty box -> undefined, so the key disappears from the saved JSON (the server wants a number or nothing).
      return (
        <Input
          type="number"
          value={value ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "select":
      return <SelectField value={value} options={field.options} onChange={onChange} />;
    case "list":
      return <ListEditor value={value} onChange={onChange} />;
    case "keyValue":
      return <KeyValueEditor value={value} onChange={onChange} />;
    case "retry":
      return <RetryEditor value={value} onChange={onChange} />;
    case "operations":
      return <OperationsEditor value={value} onChange={onChange} />;
    default:
      return null;
  }
}

// Props: node = the one selected React Flow node, onChange(nodeId, patch) = merge patch into node.data.
export default function ConfigPanel({ node, onChange }) {
  const { deleteElements } = useReactFlow();
  const def = nodeTypes[node.type];
  const Icon = def.icon;
  const config = node.data.config;

  const setConfig = (name, value) => onChange(node.id, { config: { ...config, [name]: value } });

  return (
    <aside className="w-80 shrink-0 overflow-auto border-l bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="flex-1 font-medium">{def.label}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete node"
          // deleteElements also removes the edges attached to the node.
          onClick={() => deleteElements({ nodes: [{ id: node.id }] })}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="space-y-4 p-3">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={node.data.label} onChange={(e) => onChange(node.id, { label: e.target.value })} />
          {/* Later nodes read this node's result through its id, so show it. */}
          <p className="text-xs text-muted-foreground">
            Id: <span className="font-mono">{node.id}</span> (use as {"{{nodes." + node.id + ".output}}"})
          </p>
        </div>

        {def.fields.length === 0 && <p className="text-muted-foreground">Nothing to configure.</p>}

        {def.fields
          .filter((field) => !field.showIf || field.showIf(config))
          .map((field) => (
            <div key={field.name} className="space-y-1">
              <Label>{field.label}</Label>
              <FieldInput field={field} value={config[field.name]} onChange={(v) => setConfig(field.name, v)} />
            </div>
          ))}
      </div>
    </aside>
  );
}
