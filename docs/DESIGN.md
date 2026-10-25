# Design System

Goal: a dense, professional developer tool. Not a marketing page. It should not look AI-generated or templated.

## References (match these, do not invent a new style)
- Canvas and nodes: n8n (dotted grid background, compact node cards, status dot, animated active edge)
- Shell, sidebar, density, Ctrl+K command palette: Linear
- Dashboard, execution history list, log viewer, status badges: Vercel
- Dark theme with floating panels and 1px subtle borders: Railway

Reference screenshots live in `docs/reference/`. If screenshots are present, look at them and match density and style. If not, follow the tokens below.

## Components
- Base: shadcn/ui in JavaScript mode (`"tsx": false` in components.json) with Tailwind.
- Icons: lucide-react only. No emojis as icons.
- Optional accent components from ui.watermelon.sh: max 3-4, only where they add real value. Do not install other UI libraries without asking.
- React Flow: customize node components (check reactflow.dev/ui for shadcn-based node components; verify license and maintenance before using).

## Tokens (set up first as CSS variables; use everywhere; no hardcoded colors)
- Default dark theme; light theme via the same variables.
- Background `#0A0A0B`, surface `#111113`, border `#26262B`, text `#EDEDEF`, muted text `#8B8B93`.
- One accent: emerald `#10B981` for primary actions.
- Status colors: running blue, success green, failed red, skipped gray, waiting amber (reserved for v2).
- Fonts: Geist (or Inter) for UI, Geist Mono for logs and JSON. Type scale 12/13/14/16/20/28.
- Radius 6px on controls, 10px on panels. 1px borders instead of shadows.
- Spacing on a 4px grid. Compact density: 32px control height, 36px table rows.

## Do not
- Purple or blue gradients, glassmorphism, glow effects, gradient text.
- Oversized rounded cards with heavy shadows.
- Decorative animation. Motion only for status changes and panel transitions.
- Generic card grids with centered hero text.

## Layout
- Left narrow sidebar: Workflows, Executions, Settings.
- Editor: node palette (left), canvas (center), config panel (right, slides in when a node is selected), execution log (bottom, collapsible, resizable).
- Top bar: breadcrumb, workflow name (inline editable), status badge, Save, Run, Stop.
- Ctrl+K command palette for navigation and actions.

## Nodes on the canvas
- Compact card: type icon, label, status dot, one-line summary of config.
- States: idle, running (pulse), success, failed, skipped (dimmed). Active execution path uses an animated edge.
- Handles: Condition has two labeled source handles, `true` and `false`.

## Execution log panel
- Monospace, collapsible per node, JSON viewer for input and output, copy button.
- Shows node order, timings, retry attempts, and a human-readable skip reason.

## Required states everywhere
Empty states, loading skeletons, error states, toasts for save and run results, confirm dialogs for delete.

## Keyboard shortcuts
Ctrl+S save, Ctrl+Enter run, Delete removes the selected node, Ctrl+K command palette.

## Responsive
Optimized for laptop screens. The editor does not need to work on mobile.

## Review step
Before finishing the UI phase, compare the screens against the references and fix any deviation.
