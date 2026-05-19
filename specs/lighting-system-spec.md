# LightingSystem — Implementation Spec

## What It Is
A single file — `LightingSystem.js`. Creates and manages all lights in the scene. Leaf node — no outputs to other systems. All lights except Niko's are static after scene load.

---

## Light Types

| Type | Source | Behavior | Shadow Casting |
|---|---|---|---|
| Niko | Attached to camera | Dynamic — intensity + radius driven by `sanityFloat` | No |
| General zone | Zone data (`light_zones`) | Static after placement | No |
| Torch | Zone data (`torch_zones`) | Static after placement — warm, high intensity | No |
| Artifact | Zone data (`artifact_zones`) | Static after placement — soft glow, distinctive color | No |

No lights cast shadows. All lights are for depth and atmosphere, not visibility. Ambient light handles baseline visibility.

---

## Zone Layer Additions

Three new layers added to the zone editor alongside existing `dark_zones`:

| Layer | PointLight defaults |
|---|---|
| `light_zones` | Neutral color, moderate intensity, radius matches zone size |
| `torch_zones` | Warm orange, high intensity, tight radius |
| `artifact_zones` | Soft blue-white, low intensity, small radius |

Each zone rectangle → one PointLight created at center XZ, placed at a fixed Y height. Radius derived from zone dimensions. Parameters are hardcoded per layer type — tunable constants at top of file.

---

## Niko's Light

Single PointLight. Created at init, attached to the Three.js camera on `ACTIVE` enter via `setCamera(cam)` call from GSM.

Driven each frame by `sanityFloat`:
- High sanity → full intensity, full radius
- Low sanity → reduced intensity, reduced radius
- Min values are floored — light never goes fully off

---

## Initialization Sequence

1. Scene loads (SceneManagement fires `onSceneReady`)
2. LightingSystem reads zone data file
3. Creates one PointLight per zone rectangle, adds to scene
4. Creates Niko's PointLight (not yet attached to camera)
5. Creates AmbientLight — set per zone (desert vs temple values)
6. Waits for `ACTIVE` state — attaches Niko light to camera on enter

---

## Ambient Light

One `AmbientLight` in the scene. Two values — desert and temple — swapped on zone transition.

| Zone | Ambient level |
|---|---|
| Desert | Higher — open sky feel |
| Temple | Near-zero — darkness is the default |

Hard cut on transition (not a crossfade — this is light, not audio).

---

## Inputs

| Input | Source | Used For |
|---|---|---|
| `sanityFloat` | SanitySystem (polled each frame) | Niko light intensity + radius |
| `gameState` | GameStateMachine | Guard all updates behind `ACTIVE` |
| `sceneZone` (desert \| temple) | ZoneSystem | Ambient light swap |
| Camera reference | GameStateMachine (`setCamera`) | Niko light attachment |
| Zone data file | SceneManagement (at init) | Static light placement |
| `delta` | Render loop | Niko light lerp each frame |

---

## Outputs

None. Leaf node.

---

## Dependencies

| Dependency | What For |
|---|---|
| SanitySystem | `sanityFloat` drives Niko light |
| ZoneSystem | `sceneZone` drives ambient swap |
| GameStateMachine | `ACTIVE` guard + camera handoff |
| SceneManagement | Zone data file + scene object to add lights to |

---

## What This System Does NOT Own

- Shadow casting — no lights cast shadows
- Post-processing darkness effects — owned by PostProcessing
- Emissive materials on objects (glyphs, carvings) — set in scene setup, not managed here
- Artifact object placement — SceneManagement owns that
- Zone editor behavior — ZoneEditor owns that; LightingSystem only reads the output

---

## Tunable Constants (top of file)

All light parameters live as named constants at the top of `LightingSystem.js`. Claude Code does not hardcode values inline.

```
NIKO_INTENSITY_MAX
NIKO_INTENSITY_MIN
NIKO_RADIUS_MAX
NIKO_RADIUS_MIN
AMBIENT_DESERT
AMBIENT_TEMPLE
TORCH_INTENSITY
TORCH_COLOR
TORCH_RADIUS
ARTIFACT_INTENSITY
ARTIFACT_COLOR
ARTIFACT_RADIUS
ZONE_LIGHT_INTENSITY
ZONE_LIGHT_RADIUS_SCALE  // multiplier applied to zone dimensions
MAX_POINT_LIGHTS         // soft cap — logs warning if exceeded
```

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Too many PointLights → frame drop | Soft cap via `MAX_POINT_LIGHTS` — log warning in console if exceeded at init |
| Niko light attached before camera is ready | Attachment guarded behind `ACTIVE` enter — `setCamera()` must be called first |
| Zone data missing or malformed | Guard at init — if file fails, skip static light creation and log clearly |
| Ambient not set on zone transition | ZoneSystem event drives swap — if event missed, ambient stays at last valid value |
| Niko light lerps below floor → goes dark | Hard floor on `NIKO_INTENSITY_MIN` — never reaches zero |
| Static lights created outside `ACTIVE` | Lights are added to scene at init (always), but Niko updates are no-ops outside `ACTIVE` |
