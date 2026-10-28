# Decision: canvas library and editor patterns

## Context
The editor needs a node canvas: drag nodes from a palette, connect them with edges, pan and zoom, a minimap, and custom node cards with named handles (Condition has `true` and `false`). The stack in CLAUDE.md already names `@xyflow/react`.

## Options considered
| Option | License | Notes |
|---|---|---|
| `@xyflow/react` 12.12.0 (chosen) | MIT | Repo `xyflow/xyflow`, actively published (latest release checked: 2026-10-11). Custom nodes, named handles, controlled state, built-in minimap, controls, background. |
| `reactflow` (the old package name) | MIT | Same project under its previous name. v12 moved to `@xyflow/react`. |
| Build on raw SVG/canvas | n/a | Full control, but panning, zooming, hit testing, handles and edge routing are weeks of work and add nothing to what this project is about (the engine). |
| `dagre` auto layout | MIT | Not needed in v1: users place nodes themselves. Left for future work. |

## Choice
`@xyflow/react`, used as a normal dependency. The canvas is a solved problem. The interesting work in this project is the workflow JSON contract and the execution engine.

## What was borrowed
Nothing was copied from other projects. Only documented patterns of the library were used:
- custom node components through the `nodeTypes` prop,
- controlled `nodes` and `edges` with `useNodesState` / `useEdgesState`,
- `onConnect` plus `addEdge`,
- `screenToFlowPosition` for drop positions,
- `deleteElements` to remove a node together with its edges,
- the library's CSS variables (`--xy-*`) to apply our design tokens.

The shadcn-based node components on reactflow.dev/ui were **not** used. Their license was not checked, and our node card is about 60 lines, so we wrote our own.

## Design decisions made on top of it
- **One `NodeCard` for all six types.** Type-specific data (icon, summary, required fields) lives in `frontend/src/lib/nodeTypes.js`, so adding a node type means adding one entry there, not a new component.
- **Handle ids are the branch labels.** The Condition's source handles have ids `true` and `false`. React Flow stores the id in `edge.sourceHandle`, and the engine in Phase 3 uses that to decide which edges become active.
- **React Flow state is not the saved format.** React Flow adds UI fields (`selected`, `dragging`, `measured`, ...). `frontend/src/lib/workflowGraph.js` converts in both directions and copies only the fields in SPEC section 3, so the database never stores UI state.
- **Dirty state is derived**, by comparing the JSON that would be saved with the JSON last saved, instead of a flag set in every handler.

## Risks
- React Flow's CSS variable names can change between major versions. The overrides are isolated in one block at the bottom of `frontend/src/index.css`.
- The in-app navigation guard for unsaved changes is missing: `BrowserRouter` has no blocker API (it needs a data router). Only tab close and reload are guarded.
