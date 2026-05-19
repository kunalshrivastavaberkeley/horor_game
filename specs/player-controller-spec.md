# PlayerController — Implementation Spec

---

## What It Owns
- Player world position
- Look direction (camera yaw + pitch)
- Current movement state: `walking | idle | hugging`
- Niko state: `held | hugging`
- Pointer lock state
- Artifact pickup raycast + proximity check
- Reference to the Three.js camera (borrowed from GSM during `ACTIVE`)

---

## Movement

Two meaningful states: `walking` (WASD input) and `idle` (no input). No sprint.

`hugging` locks movement entirely — position does not update while `nikoState === 'hugging'`.

Holding Niko up has no movement penalty. It is the default state during gameplay — there is no mechanical reason to put Niko away.

**Grounding:** downward raycast against the desert collision mesh and temple GLTF. Player Y snaps to hit point each frame. If raycast misses, clamp to last valid Y as fallback.

**Wall blocking:** horizontal raycasts (4 cardinal directions) against scene geometry. If a raycast hits within capsule radius, zero out velocity in that direction.

**Capsule:** pill collider handles geometry edge cases. No additional complexity needed for wall clipping.

---

## Niko Interaction

| Input | State change | Effect |
|---|---|---|
| Press E | `held ↔ hugging` toggle | If held → hugging: movement locked, screen hands off to PostProcessing. If hugging → held: movement unlocks, PostProcessing begins unwind. |

Niko is held by default. No mechanical reason to put away. Effective gameplay states are `held` (default, moving freely) and `hugging` (stopped, eyes closed).

`nikoState` is emitted each frame to: LightingSystem, SanitySystem, AudioSystem, PostProcessing.

---

## Artifact Interaction

One artifact in the scene. Generous proximity threshold (exact value tuned in-engine).

Each frame during `ACTIVE`: check distance between player position and artifact position. If within threshold AND player presses E → fire `onArtifactPickedUp` → EnemySystem.

Artifact disappears from scene on pickup. One-shot — interaction flag set on pickup, disabled permanently after.

---

## Camera

PlayerController does **not** own the Three.js camera. It receives it from GameStateMachine when `ACTIVE` state begins via a `setCamera(cam)` call. Camera is attached to player position and look direction every frame during `ACTIVE`. On state exit, camera reference is released.

> **GSM addendum required:** GSM spec needs camera allocation added — hands Three.js camera to PlayerController on `ACTIVE` enter, reclaims on `ACTIVE` exit.

---

## Pointer Lock

Acquired on first click during `ACTIVE`. If lost mid-game (tab out, external click) → auto-pause: fire `onPause` → GameStateMachine. Re-acquiring pointer lock unpauses.

---

## Inputs

| Input | Source |
|---|---|
| WASD | Keyboard |
| Mouse delta | Pointer lock |
| E press | Keyboard |
| `gameState` | GameStateMachine (movement locked outside `ACTIVE`) |
| Three.js camera | GameStateMachine (allocated on `ACTIVE` enter) |
| Collision mesh | SceneManagement (passed at init) |
| Artifact world position | SceneManagement (passed at init) |

---

## Outputs

| Output | Consumer |
|---|---|
| `playerPosition` | SanitySystem, EnemySystem, AudioSystem, ZoneSystem |
| `nikoState` | LightingSystem, SanitySystem, AudioSystem, PostProcessing |
| `movementState` | AudioSystem (footsteps) |
| `onArtifactPickedUp` | EnemySystem |
| `onPause` | GameStateMachine |

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Grounding raycast misses on uneven terrain edge | Clamp to last valid Y, don't let player fall through |
| Artifact proximity check fires repeatedly | One-shot flag — disable after first pickup |
| Camera not returned cleanly on state exit | GSM reclaims camera reference on `ACTIVE → END` transition |
| Pointer lock not available (Firefox, some browsers) | Fallback: mouse events still fire, just no capture — degrade gracefully |
| Movement input bleeds through while hugging | Zero velocity explicitly on hug enter, don't rely on input absence |
