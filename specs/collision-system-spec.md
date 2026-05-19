# Collision System — Implementation Architecture

## Overview

Collision is four separate systems. They do not share a file or a base class. Splitting them is an intentional optimization decision — player movement and snake movement have fundamentally different complexity, and LineOfSight is a pure utility with no state.

| File | Responsibility |
|---|---|
| `PlayerCollision.js` | Wall blocking + terrain grounding for the player capsule |
| `SnakeCollision.js` | Surface detection, orientation tracking, and wall/floor/ceiling transitions for the snake |
| `LineOfSight.js` | Single raycast from snake to Niko light — returns boolean |
| `TriggerSystem.js` | Zone-based event triggers (exit zone → game end) |

---

## PlayerCollision.js

### Responsibility
Keeps the player from walking through walls and keeps them grounded on the terrain. No jumping. No gravity simulation. No ceiling detection needed — temple is tall enough.

### How It Works

**Wall blocking — 8 horizontal raycasts**
Rays fire outward from the capsule center in 8 directions (N, NE, E, SE, S, SW, W, NW) at capsule height. If a ray hits the temple GLTF or desert mesh within a minimum clearance distance, movement in that direction is blocked. The capsule cannot pass through geometry.

**Terrain grounding — 1 downward raycast**
A single ray fires straight down from the capsule center. It hits the terrain mesh (desert or temple floor) and returns the Y-position of the surface. The player's Y is snapped to that value every frame. This is not gravity — it's a continuous ground lock. If the ray misses (e.g. player walks off an edge), Y holds at last known ground value.

**Crouch state**
Crouching (Niko hug / light interaction) reduces the capsule height. The downward raycast origin adjusts accordingly. No other collision behavior changes during crouch.

### Inputs
- Player intended movement vector (from PlayerController)
- Temple GLTF mesh reference (from SceneManagement)
- Desert collision mesh reference (from SceneManagement)
- Current zone (from ZoneSystem) — determines which mesh to ground against

### Outputs
- Resolved movement vector (wall-blocked)
- Current ground Y position
- `isGrounded` boolean

### What This System Does NOT Own
- Player speed or movement input — that's PlayerController
- Which zone the player is in — that's ZoneSystem
- Crouching trigger — that's PlayerController (this system just adjusts capsule dimensions when told)

---

## SnakeCollision.js

### Responsibility
Gives the snake awareness of its physical environment — what surface it's on, where nearby surfaces are, and whether it's approaching a transition (floor → wall, wall → ceiling, etc.). Does not control snake behavior or movement decisions — it only provides surface data. EnemySystem reads from this to make movement decisions.

### Core Problem: Single GLTF Mesh
The temple is one mesh. There are no separate floor, wall, or ceiling objects to query. The snake must determine what kind of surface it's on by reading surface normals from its own raycasts and comparing them to the world up vector.

- **Normal ≈ world up (angle < ~30°):** floor
- **Normal ≈ world horizontal (angle ~60–90°):** wall
- **Normal ≈ world down (angle > ~150°):** ceiling

The snake always knows its own orientation relative to the world. This is the single most important output of this system.

### How It Works

**Surface detection — cardinal + diagonal raycasts in 3D**
Rays fire from the snake body center outward in all 6 axis directions (up, down, forward, back, left, right) plus diagonals between them. Each ray that hits returns:
- Distance to surface
- Surface normal at hit point

The snake uses this data to know: what is immediately beneath me, what is directly ahead of me, and whether any nearby surface is transitioning type (e.g. floor ahead is curving into a wall).

**Orientation tracking**
The snake maintains a `currentSurfaceNormal` — the normal of the surface it's currently crawling on. This is updated every frame from the ray directly "behind" the snake (perpendicular to its crawling direction). The snake's local up axis aligns to this normal.

**Transition detection — floor to wall**
When the forward ray hits a surface whose normal differs significantly from `currentSurfaceNormal` (angle delta > threshold, ~60°), the snake is approaching a surface type transition. It begins rotating its local up axis toward the new surface normal over several frames, producing a smooth wall-climb transition. The threshold angle is the design lever for how aggressively the snake hugs corners.

**Transition detection — wall to ceiling**
Same mechanism. The snake does not distinguish wall-to-ceiling differently from floor-to-wall — it's the same rotation logic against the same surface normal delta. This means the snake can flow continuously from floor to wall to ceiling without any special-case code.

### Inputs
- Snake body position (from EnemySystem)
- Temple GLTF mesh reference (from SceneManagement)
- Desert mesh reference (from SceneManagement)

### Outputs
- `currentSurfaceNormal` — what surface type the snake is on right now
- `nearestSurfaces[]` — array of hit results from all active raycasts (distance + normal per direction)
- `approachingTransition` boolean — true when a surface type change is detected ahead
- `targetTransitionNormal` — the normal of the incoming surface, if transition is detected

### What This System Does NOT Own
- Snake movement speed or path decisions — that's EnemySystem
- Zigzag and patrol patterns — that's EnemySystem
- Whether the snake is currently chasing or patrolling — that's EnemySystem

---

## LineOfSight.js

### Responsibility
One job: answer the question "can the snake currently see the Niko light?" Returns a boolean. No state, no memory. Stateless utility.

### How It Works
A single raycast fires from the snake's head position toward the Niko light position (which is the player camera position). If the ray reaches the target without hitting the temple GLTF mesh, the answer is `true`. If it hits geometry first, the answer is `false`.

This check does not run every frame. It is called by EnemySystem on whatever interval makes sense for performance (e.g. every 3–5 frames, or on a fixed timer).

### Inputs
- Snake head position (from EnemySystem)
- Niko light world position (from PlayerController → camera position)
- Temple GLTF mesh reference (from SceneManagement)

### Outputs
- `canSeeLight` boolean

### What This System Does NOT Own
- What the snake does when it sees the light — that's EnemySystem
- Last known position memory — that's EnemySystem
- Search behavior after losing sight — that's EnemySystem

---

## TriggerSystem.js

### Responsibility
Detects when the player enters a defined zone and fires the corresponding event. Currently owns one trigger: the exit zone.

### How It Works
Trigger zones are defined as invisible volumes (bounding boxes or spheres) placed in world space. Each frame, the player's position is checked against all registered trigger volumes. If the player is inside a volume and wasn't last frame, the trigger fires once. It does not fire again until the player exits and re-enters.

This is not raycast-based — it's a position-in-volume check. Cheaper and appropriate for zone-sized areas.

### Current Triggers

| Trigger | Zone Location | Event Fired |
|---|---|---|
| Exit | Temple exit doorway | `GameStateMachine.onExitReached()` |

### Inputs
- Player world position (from PlayerController)
- Trigger zone definitions (set during SceneManagement load)

### Outputs
- Events fired to GameStateMachine on zone entry

### Extensibility
New triggers are registered by passing a volume definition + callback at scene load time. TriggerSystem does not know what the zones are for — it just checks positions and fires callbacks. Adding a new trigger zone in the future requires no changes to this file.

### What This System Does NOT Own
- What happens after a trigger fires — that's GameStateMachine
- Enemy activation zones — if those exist, they register here as a callback to EnemySystem

---

## Shared Dependencies

| Dependency | Used By |
|---|---|
| Temple GLTF mesh | PlayerCollision, SnakeCollision, LineOfSight |
| Desert collision mesh | PlayerCollision, SnakeCollision |
| Player camera position | LineOfSight (as Niko light position) |
| GameStateMachine | TriggerSystem (event target) |

All mesh references are passed in at initialization from SceneManagement. No system fetches its own assets.

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Player clips through thin geometry | Minimum ray length should be at least capsule radius; don't let player get closer than clearance threshold |
| Snake loses surface contact mid-crawl (ray misses) | Hold `currentSurfaceNormal` at last valid value; re-acquire on next frame |
| Snake transition rotation overshoots | Lerp toward `targetTransitionNormal`, don't snap — if lerp rate is tuned correctly, overshoot doesn't happen |
| LineOfSight ray hits snake's own geometry | Ignore self by excluding snake mesh from raycast target set |
| TriggerSystem fires repeatedly while player stands in zone | Edge-trigger only: fire once on entry, reset on exit |
| Desert terrain ray misses on uneven edges | Clamp player Y to a minimum floor value as fallback if downward ray returns no hit |
