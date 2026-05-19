# ZoneSystem + ZoneEditor — Implementation Spec

## Overview

Two distinct pieces. ZoneSystem is the runtime — a lightweight config reader that answers one question: is this XZ coordinate dark or not? ZoneEditor is the dev-mode authoring tool — a top-down rectangle editor that writes to the config file ZoneSystem reads. They share one file: `/data/zones.json`.

---

## ZoneSystem (Runtime)

### Responsibility
Answers `isDark(x, z)` — a single boolean check against a static config. No state, no per-frame work beyond the query. Called by SanitySystem to determine drain rate.

### How It Works
At init, fetches `/data/zones.json` and builds an internal array of zone entries. Each entry has a center (X, Z), size (width, depth), layer name, and flag. When queried, iterates the array and checks whether the given X,Z coordinate falls inside any rectangle. Returns the flag of the matching rectangle.

Zones are non-overlapping by design — enforced at authoring time by ZoneEditor. Every coordinate belongs to exactly one zone. No priority logic needed.

### Data Shape (from zones.json)
```json
[
  {
    "layer": "dark_zones",
    "x": 12.5,
    "z": -4.0,
    "width": 6.0,
    "depth": 3.0,
    "flag": "dark"
  },
  ...
]
```

### Inputs
| Input | Source |
|---|---|
| Player X,Z position | PlayerController |
| `/data/zones.json` | Filesystem, loaded at init |

### Outputs
| Output | Consumer |
|---|---|
| `isDark(x, z)` → boolean | SanitySystem |

### What ZoneSystem Does NOT Own
- What happens when the zone is dark — that's SanitySystem
- Authoring or editing zones — that's ZoneEditor
- Any per-frame updates — it is queried on demand, runs nothing on its own

### Failure Modes
| Risk | Mitigation |
|---|---|
| `zones.json` missing on first run | Return `false` (treat as light) — no crash |
| Player position falls outside all rectangles | Default return `false` — log a warning in dev mode |
| File fetch fails at runtime | Catch error, initialize with empty array, log warning |

---

## ZoneEditor (Dev Mode)

### Responsibility
A top-down visual editor for drawing and editing zone rectangles, organized into named layers. Writes to `/data/zones.json` via a dev server endpoint. Only active when `DEV_MODE = true`. Invisible and zero-cost at runtime.

### Dev Mode Toggle
A boolean `DEV_MODE` in the top-level config file. When `false`, ZoneEditor does not initialize — no overhead, no objects created.

On dev mode enter:
- Active camera swaps from perspective to orthographic top-down
- Player input suspended (no movement, no Niko interaction)
- Active layer group set to visible
- ZoneEditor UI panel renders
- Fetches `/data/zones.json` and reconstructs all layer meshes

On dev mode exit:
- Camera swaps back to perspective
- Player input restored
- All layer groups set `visible = false`
- UI panel removed

### Camera
Orthographic camera positioned directly above the scene center, looking straight down. Scroll wheel zooms (adjusts orthographic frustum size). Click and drag on empty space pans. No rotation.

### Layers
Each layer is a named `THREE.Group`. Only one layer is active at a time — only the active layer's group is visible, all others are hidden.

Starting layers (defined at init, not created dynamically):
| Layer Name | Purpose | Color |
|---|---|---|
| `dark_zones` | Marks XZ regions as dark | Semi-transparent red |
| `artifact_spawns` | Marks artifact positions | Semi-transparent blue |

Additional layers are added in code as needed. Each layer has an assigned color for its rectangles.

### UI Panel
A simple HTML `div` overlay, absolutely positioned over the canvas. Contains:
- List of layer names — click to switch active layer
- Active layer highlighted
- "Save" button
- "Delete Selected" button

No keyboard shortcuts for layer switching. Delete key also triggers delete selected (dev-only exception — acceptable).

### Drawing Rectangles
**New rectangle:**
Mousedown on empty space starts a draw. Mousemove updates the rectangle live. Mouseup finalizes it.

On mousedown: raycast against existing meshes first. If a mesh is hit, enter move/select mode instead of draw mode.

On mouseup: overlap check runs against all existing rectangles on the active layer. If any AABB intersection is detected, the new rectangle is rejected — flashes red briefly, then disappears. Otherwise it is added to the active layer group.

Rectangle is a `THREE.Mesh` with `PlaneGeometry` (1x1 base) placed on the XZ plane at `Y = 0.01` to avoid z-fighting. Size is driven by `scale.x` and `scale.z`. Material is semi-transparent `MeshBasicMaterial` in the layer's assigned color.

**Select:**
Click on an existing rectangle. It highlights (brighter color, visible edge outline via `EdgesGeometry`). Corner handles appear — four small squares at each corner.

**Move:**
Drag a selected rectangle from its center area.

**Resize:**
Drag any of the four corner handles. Updates `scale.x` and/or `scale.z` accordingly.

**Deselect:**
Click empty space.

**Delete:**
Delete key or "Delete Selected" button removes the selected rectangle from the layer group.

### Overlap Check
On mouseup after drawing, iterate all existing meshes on the active layer. Compare axis-aligned bounding boxes on XZ plane. Expand each AABB by a small epsilon before comparing to account for floating point edge cases. If any intersection exists, reject the new rectangle. Simple AABB vs AABB — no spatial indexing needed given low rectangle count.

### Persistence

**Save**
Save button serializes all layer groups. For each mesh in each layer group, captures:
- `layer` — layer name string
- `x`, `z` — `mesh.position.x`, `mesh.position.z`
- `width`, `depth` — `mesh.scale.x`, `mesh.scale.z`
- `flag` — derived from layer name (e.g. `dark_zones` → `"dark"`)

POSTs the serialized array as JSON to `POST /dev/save-zones`. The Vite middleware receives it and writes to `/data/zones.json`.

**Load (on editor init)**
Fetches `/data/zones.json`. For each entry, reconstructs the mesh with the correct geometry, material color, position, and scale, and adds it to the corresponding layer group. Zones are exactly where they were left on the previous session.

**Vite Middleware**
A dev-only plugin added to `vite.config.js`. Registers the `POST /dev/save-zones` route. Parses the request body and writes it to `/data/zones.json` using Node's `fs.writeFile`. Stripped entirely from the production build — not present at runtime.

```js
// vite.config.js (dev plugin sketch — for Claude Code reference)
{
  name: 'zone-editor-save',
  configureServer(server) {
    server.middlewares.use('/dev/save-zones', (req, res) => {
      // parse body, fs.writeFile to /data/zones.json, respond 200
    })
  }
}
```

### What ZoneEditor Does NOT Own
- What zone data means at runtime — that's ZoneSystem
- Game state during dev mode — GSM treats `DEV_MODE` as a suspended state
- Creating new layer types dynamically — layers are defined in code at init

### Failure Modes
| Risk | Mitigation |
|---|---|
| Mousedown on existing rectangle accidentally starts a draw | Raycast on mousedown first — if mesh hit, enter select/move mode, not draw mode |
| Overlap check misses due to floating point | Expand AABB by epsilon before comparing |
| Save fails (disk write error) | Log error in console, show brief red flash on Save button |
| Load finds malformed zones.json | Catch parse error, initialize with empty layers, log warning |
| Zone meshes visible at runtime | All layer groups explicitly set `visible = false` on dev mode exit and never touched again |

---

## Shared Data Contract

`/data/zones.json` is the single source of truth. ZoneEditor writes it. ZoneSystem reads it. Neither owns it — it is a file artifact.

Format: flat array of zone objects. One object per rectangle. No nesting.

```json
[
  { "layer": "dark_zones", "x": 0, "z": 0, "width": 5, "depth": 5, "flag": "dark" },
  { "layer": "dark_zones", "x": 10, "z": 0, "width": 5, "depth": 5, "flag": "light" },
  { "layer": "artifact_spawns", "x": 3, "z": 2, "width": 1, "depth": 1, "flag": "spawn" }
]
```
