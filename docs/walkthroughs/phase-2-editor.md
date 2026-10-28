# Phase 2: Workflow API and the editor

## 1. What was built
- A workflow CRUD API: create, list, read, update, delete and duplicate, all behind login and all scoped to the owner.
- Server-side validation of the workflow JSON with Zod: node types, per-type config, unique ids, edges that point at real nodes, valid `true`/`false` handles, no self-loops or duplicate edges, size limits.
- A node registry on the backend (`nodes/registry.js`): one config schema per node type. Phase 3-4 adds the execute handlers to the same entries.
- A dashboard: list, create, duplicate and delete workflows, with loading, empty and error states.
- A React Flow editor: drag nodes from a palette, connect them, configure the selected node in a side panel, rename the workflow inline.
- Save with Ctrl+S, "Unsaved changes" tracking, and a validation panel (no trigger, cycles, unconnected nodes, missing config).
- Run and Stop are present but disabled. Nothing executes until the engine exists (Phase 3-5).
- Tests: 37 backend (12 auth + 25 workflow), 13 frontend (graph validation, graph conversion, time helper).

## 2. Flow map

**Saving a workflow (Ctrl+S)**
```
frontend/src/pages/Editor.jsx  EditorInner.save()
 -> lib/workflowGraph.js        toWorkflowJson({ name, description, nodes, edges })   (drops UI-only fields)
 -> lib/workflowApi.js          updateWorkflow(id, json)  -> lib/api.js (Axios adds Bearer token)
 -> PUT /api/workflows/:id
 -> backend/src/app.js          helmet -> cors -> express.json -> /api/workflows
 -> routes/workflowRoutes.js    requireAuth (middleware/auth.js) -> validate(workflowSchema) (middleware/validate.js)
 -> schema/workflow.js          Zod: shape, nodeRegistry[type].configSchema, superRefine (ids, edges, handles)
 -> controllers/workflowController.js  update()
 -> services/workflowService.js updateWorkflow(ownerId, id, data) -> findOwned() -> workflow.set(data).save()
 -> models/Workflow.js          -> MongoDB
 <- 200 { success: true, data: { workflow } }
Any AppError (400 validation, 404 not found) -> middleware/errorHandler.js -> { success: false, error }
```
`findOwned` queries by both `_id` and `owner`, and a malformed id also gives 404. That is why another user's workflow is indistinguishable from a missing one.

**The editor on screen**
```
App.jsx  route "workflows/:id"  inside ProtectedRoute -> AppShell -> <Outlet/>
 pages/Editor.jsx  Editor(): getWorkflow(id) -> loading / error / data
  <ReactFlowProvider>
   EditorInner  owns: name, nodes, edges (useNodesState / useEdgesState), saving, savedSnapshot
    NodePalette     drag start: event.dataTransfer.setData(DRAG_TYPE, type)
    FlowCanvas      onDrop -> screenToFlowPosition + nextNodeId -> setNodes
                    onConnect -> addEdge (edge id "edge-<source>-<handle|out>-<target>")
                    NodeCard (all 6 types; Condition has handles id="true" / id="false")
    ValidationPanel issues = validateGraph(nodes, edges); click -> selectNode(id)
    ConfigPanel     fields come from lib/nodeTypes.js; edits -> updateNodeData(id, patch)
                    complex fields -> FieldEditors.jsx (KeyValue, List, Retry, Operations)
```

## 3. One concrete trace
Building "Check an API status": Trigger -> HTTP -> Condition -> (true) Output / (false) Output.

1. **New workflow** on the dashboard: `createWorkflow` posts a workflow containing one trigger. The backend validates and stores it. The browser navigates to `/workflows/<id>`.
2. `Editor` calls `getWorkflow(id)`, and `EditorInner` mounts. `toFlowNodes` / `toFlowEdges` build the initial state. The first render computes `snapshot` (the JSON string of the canvas) and stores it as `savedSnapshot`, so `dirty` is `false` and the header says "Saved".
3. Drag **HTTP Request** onto the canvas: `onDrop` reads the type from `dataTransfer`, converts the mouse position with `screenToFlowPosition`, and adds a node with id `httpRequest-1` (from `nextNodeId`) and the type's `defaultConfig` `{ method: "GET", url: "" }`. `snapshot` now differs from `savedSnapshot`, so the header says "Unsaved changes". `validateGraph` reports "HTTP Request is not connected to the trigger" and "HTTP Request: missing URL".
4. Select it and type a URL in the config panel: `setConfig("url", ...)` calls `updateNodeData("httpRequest-1", { config: { ...config, url } })`. The card's one-line summary is recomputed by `nodeTypes.httpRequest.summary`.
5. Drag from the trigger's handle to the HTTP node: `onConnect` adds the edge `edge-manualTrigger-1-out-httpRequest-1` with `sourceHandle: null`.
6. Add a Condition node and drag from its **true** handle to an Output node: the edge is `edge-condition-1-true-output-1` with `sourceHandle: "true"`. The false handle goes to the other Output with `sourceHandle: "false"`.
7. All issues are gone, and the panel says "Ready to run". Press Ctrl+S: `toWorkflowJson` strips `selected`, `dragging` and `measured`, rounds positions, and the `PUT` is sent. The backend's `superRefine` checks that the two Condition edges have handles `true`/`false` and the others have `null`. After a 200, `savedSnapshot` becomes the snapshot that was sent, so "Saved" returns.
8. Refresh: `getWorkflow` returns the same JSON, so the same canvas appears.

## 4. See it working
Start the backend (`cd backend && npm run dev`) and the frontend (`cd frontend && npm run dev`), then open http://localhost:5173.

- Build the workflow from the trace above. Check the validation panel, press Ctrl+S, refresh, and confirm that everything is back.
- Browser DevTools (F12) -> Network: open the `PUT workflows/<id>` request. The payload should contain `"sourceHandle": "true"` and `"false"` on the Condition edges, `null` on the others, and no `selected` or `measured` fields.
- Dashboard: duplicate the workflow. A copy named `<name> (copy)` appears. Delete it and confirm the dialog.

```bash
cd backend  && npm test    # expect 37 passed
cd frontend && npm test    # expect 13 passed
cd frontend && npm run build
```

## 5. Break it on purpose
1. **Cycle.** Connect the last Output back to the HTTP node. Expected: the validation panel lists "is part of a cycle" for the nodes involved. Saving still works, because drafts are allowed. The engine will reject it in Phase 3.
2. **Second trigger.** The trigger entry in the palette is greyed out and cannot be dragged (`draggable={!disabled}`). `FlowCanvas.onDrop` also re-checks and shows a toast, as a second line of defence. Only the server (Phase 3) and `validateGraph` enforce "exactly one trigger" for workflows that arrive some other way.
3. **Bad data straight to the API.** Send a workflow with a node of type `shellCommand`, or an edge to a node id that does not exist (curl with your token). Expected: 400 `VALIDATION_ERROR` with `details` pointing at the field, such as `nodes.0.type` or `edges.0.target`.
4. **Another user's workflow.** Register a second user and open the first user's `/workflows/<id>` URL, or `GET` it with curl. Expected: 404, not 403.
5. **Unsaved changes.** Move a node and press F5. Expected: the browser asks before leaving. Move the node back to the exact same spot: the header returns to "Saved", because dirty is derived by comparing JSON.

## 6. Likely interview questions
1. **Why does the server validate when the frontend already does?** The frontend checks are only for fast feedback, and anyone can call the API directly. The server never trusts incoming workflow JSON: it validates types, configs, ids, edges and sizes with Zod, and strips unknown fields.
2. **Why store the graph as plain JSON in one document, not as nodes and edges in separate collections?** A workflow is always loaded and saved as a whole, the graph is small (limit 50 nodes), and the engine needs the whole graph anyway. One document means one atomic save and no joins.
3. **What does the `id` on the Condition's handles do?** It becomes `edge.sourceHandle`, which is how the engine knows whether an edge belongs to the true or the false branch. Normal nodes have one output, so their `sourceHandle` is `null`.
4. **How does the editor know there are unsaved changes?** It turns the canvas into the JSON it would send and compares that string with the last saved string. Selecting nodes or dragging back to the same spot does not count as a change, because UI-only fields are not in the JSON.
5. **Why return 404 instead of 403 for another user's workflow?** A 403 confirms the id exists. A 404 reveals nothing, and `findOwned` filters by owner in the query itself so there is no code path that forgets the check.

## 7. Glossary
- **React Flow (`@xyflow/react`)**: the library that draws the node canvas, handles dragging, connecting, zooming and the minimap.
- **Handle**: a connection point on a node. A handle's `id` is stored in the edge as `sourceHandle` (or `targetHandle`).
- **Controlled state**: React owns the `nodes` and `edges` arrays, and React Flow reports changes through `onNodesChange` / `onEdgesChange`.
- **`screenToFlowPosition`**: converts a screen pixel position to canvas coordinates, accounting for pan and zoom.
- **Node registry**: a map from node type to its definition (config schema now, execute handler later). Adding a node type means adding one entry.
- **Zod `superRefine`**: a validation step that can check relationships between fields, such as "every edge points at an existing node".
- **Derived state**: a value computed from other state during render (`dirty`) instead of stored separately, so it cannot go out of sync.
- **Ownership check**: filtering by `owner` in every query so users can only reach their own data.
