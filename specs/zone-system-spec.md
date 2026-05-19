# ZoneSystem — Implementation Architecture

## Core Concept

A layered pipeline that evaluates an XZ position against N layers of zone definitions. Runs every frame. Entity-agnostic — any object with an XZ position can be fed through it. Complexity lives in the layers and zone data, not in the evaluator.

---

## Pipeline

Every frame, for each registered entity, for each layer, for each zone in that layer: check if position is inside the rectangle. Total cost is N×M comparisons per entity — trivial math at any reasonable scale.

Edge detection is per-zone per-entity. Each zone tracks whether the entity was inside last frame. Entry fires when state changes out→in. Exit fires when state changes in→out. Does not fire repeatedly while inside.

---

## Current Layers

| Layer | Type | Output |
|---|---|---|
| Shadow | Continuous state | `inShadow` boolean → SanitySystem |
| Event Trigger | Edge trigger | Callback → GameStateMachine |
| Artifact | Interaction zone | `artifactPickedUp` → EnemySystem (on E press while inside) |

New layers are added by defining a new layer type and registering zone data. No changes to the pipeline evaluator itself.

---

## Zone Data Model

Each zone definition contains: layer type, min XZ, max XZ, and layer-specific payload (callback name, artifact ID, etc.). All zone definitions live in a flat data file. SceneManagement loads this file at startup and registers zones with the pipeline before gameplay begins.

---

## Inputs

| Input | Source |
|---|---|
| Player XZ position | PlayerController (every frame) |
| Snake XZ position | EnemySystem (future) |
| E press | PlayerController (artifact layer interaction) |
| Zone definition file | SceneManagement (at init) |

---

## Outputs

| Output | Consumer |
|---|---|
| `inShadow` boolean | SanitySystem |
| `sceneZone` (desert \| temple) | LightingSystem, AudioSystem |
| Zone entry events | GameStateMachine |
| `artifactPickedUp` | EnemySystem |

---

## What This System Does NOT Own

- What happens after an event fires — that's GameStateMachine
- Artifact objects in the scene — those are SceneManagement's concern
- Snake behavior in zones — future, not implemented yet
- Zone definitions themselves — produced by the editor tool
- The editor tool — separate deliverable, separate spec

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Entry event fires every frame while inside zone | Edge detection required — per-zone inside/outside state tracked each frame |
| Zone file missing or malformed at load | SceneManagement guards against this — block game start if file fails to load |
| Artifact zone fires pickup without E press | Artifact layer is not a passive trigger — E press is required while inside |
| Multiple artifact zones overlap | Each zone has its own edge state — both can be active simultaneously, E press picks the nearest |
| Snake evaluated before behavior is ready | Entity registration is opt-in — snake is not registered until EnemySystem is ready |

---

## Open Items

- **Editor tool** — separate deliverable, separate spec. Produces the zone definition file via a 2D drag-and-drop interface mapped to the XZ plane.
- **SanitySystem update** — sanity now has two inputs: `inShadow` (from ZoneSystem) and `nikoHeld` (from PlayerController). Previous spec had nikoState as the sole driver. Needs reconciliation.
- **PlayerController update** — `artifactPickedUp` event source moves from PlayerController to ZoneSystem. Dependency rewire needed in EnemySystem.
