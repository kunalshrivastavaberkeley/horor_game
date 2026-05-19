# Enemy System — Full Spec

## Design Principle

> The player doesn't see the monster. They see its presence. The environment becomes wrong before the snake is visible.

---

## Behavior & States

**State machine:**

```
inactive → wandering   (artifact pickup)
wandering → idle       (random pause timer)
idle → wandering       (idle timer expires, no detection)
idle → hunt            (raycast clear + detection radius crossed)
hunt → searching       (player moves into darkness, raycast blocked)
searching → wandering  (search timer expires)
hunt → END             (player caught → jumpscare → game state machine)
```

**Detection logic:**
- Detection radius = `maxRange × playerLightLevel`
- In darkness, radius is zero — cannot detect player
- Chases last known **lit** position, not current player position
- If player moves into darkness, snake loses them and searches
- Search = chaotic drift toward last known lit position
- After search timer expires, returns to wandering

---

## Inputs

| Input | Source |
|---|---|
| `artifactPickedUp` | Player controller — activates enemy |
| `playerLightLevel` | Zone system — drives detection radius |
| `playerPosition` | Player controller — movement target + raycast endpoint |
| `delta` | Render loop — movement, timers |

---

## Outputs

| Output | Destination |
|---|---|
| `enemyPosition` | Audio system — proximity sound |
| `enemyProximityFactor` | Sanity system — sanity degradation |
| `onPlayerCaught` | Game state machine — jumpscare → END |

---

## What It Owns

- Current state
- Last known lit position (updated only when detection active)
- Movement speed per state (slow wandering, fast hunt, chaotic search)
- Idle timer, search timer
- Single raycast — enemy head → player, wall check (LineOfSight.js)
- Detection radius calculation

---

## Visual — The Body

**Spline skeleton**
- 5–6 spline points defining the snake's spine
- Each point independently tracks the surface beneath it via raycasts
- Updates staggered — head every frame, middle points every 2–3 frames, tail every 4–5
- Snake body follows the path the head has taken (tail drags through recorded positions)

**Rendering**
- Sparse soft points clustered around the spline
- Gaussian falloff texture per point — no hard edges, no visible rectangle boundary
- Additive blending, very low alpha (~0.15–0.25)
- Billboarded — always faces camera regardless of angle
- Dark with faint glow — point light attached to snake, low intensity
- Very few points total — less is more. Suggestion over representation.

---

## Visual — The Presence

This is what the player actually experiences. The body is almost incidental.

**Shedding particles**
- Very few ambient particles emitting from snake position
- Drift slowly toward the player
- Pass close to the camera — invasion of personal space
- Small, soft, slow. Never fast, never many.
- The same dust-in-light quality — real because of proximity and scale, not because of visual complexity

**Environment darkening**
- Niko light dims on snake proximity — driven by lighting system
- Shadows deepen around the snake
- The room gets wrong before the snake is visible

**Audio** *(already specced — audio system)*
- Proximity distortion scales with distance
- `THREE.PositionalAudio` on enemy position

**Sanity** *(already specced — sanity system)*
- `enemyProximityFactor` drives screen distortion and decay rate

---

## Collision — Supporting Files

| File | Responsibility |
|---|---|
| `SnakeCollision.js` | Surface detection, orientation tracking, wall/floor/ceiling transitions |
| `LineOfSight.js` | Single raycast snake → Niko light. Returns boolean. Stateless. |

**SnakeCollision detail:**
- Fan of raycasts around snake body — forward, downward, diagonal
- Returns surface normal per point
- Snake orients to surface normal — flows from floor to wall to ceiling without special-case code
- `approachingTransition` boolean fires when surface normal delta exceeds threshold (~60°)
- Smooth rotation toward new normal over several frames — no snapping

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Wandering out of bounds | Collision system bounds — snake stays on wall/floor paths |
| Search movement leaving geometry | Constrain search drift to last known surface |
| Jumpscare asset loading cold | Preload alongside audio assets before ACTIVE state |
| Staggered raycast visible lag on tail | Tune stagger intervals — imperceptible at 60fps |
| Too many shedding particles killing performance | Hard cap, object pool, recycle on camera-pass |

---

## Dependencies

| System | Relationship |
|---|---|
| Zone system | Upstream — provides `playerLightLevel` |
| Player controller | Upstream — provides `playerPosition`, `artifactPickedUp` |
| Collision system | Upstream — `SnakeCollision.js`, `LineOfSight.js` |
| Lighting system | Downstream — receives proximity to drive Niko dimming |
| Audio system | Downstream — receives `enemyPosition` |
| Sanity system | Downstream — receives `enemyProximityFactor` |
| Game state machine | Downstream — receives `onPlayerCaught` |
| Scene management | Upstream — provides mesh references for raycasting |
