# PostProcessing — Implementation Spec

## What It Is

Single file — `PostProcessing.js`. Owns the EffectComposer, one custom ShaderPass, and the hug sequence state machine. Pure leaf node for sanity effects — no outputs. Exception: temporary camera ownership during the hug sequence, which is handed back to PlayerController on completion.

---

## Pipeline

```
RenderPass (scene + camera)
    ↓
CustomShaderPass (all effects, one GLSL fragment shader)
    ↓
Output to screen
```

Two passes total. That's the budget.

---

## Custom Shader — Uniforms

All effects live in one fragment shader. Uniforms updated every frame.

| Uniform | Type | Source | Drives |
|---|---|---|---|
| `sanityFloat` | float 0→1 | SanitySystem | All sanity effects |
| `blackOverlay` | float 0→1 | Hug sequence state machine | Fade to black + blink |
| `time` | float | Render loop (accumulates delta) | Animated grain noise |
| `shakeOffset` | vec2 | Hug sequence state machine | Screen shake UV offset |

---

## Effects in the Shader (all driven by `sanityFloat`)

| Effect | Implementation |
|---|---|
| Vignette | Radial darkening from UV edges, scaled by `sanityFloat` |
| Chromatic aberration | R/G/B channel UV offsets, scaled by `sanityFloat` |
| UV warp / distortion | sin/cos UV displacement, amplitude scaled by `sanityFloat` |
| Film grain | Noise function seeded by `time` + UV, opacity scaled by `sanityFloat` |
| Desaturation | Lerp toward grayscale, amount scaled by `sanityFloat` |
| Screen sway | Continuous low-amplitude UV roll, scaled by `sanityFloat` |
| Black overlay | Flat black on top, driven by `blackOverlay` uniform (hug only) |
| Screen shake | UV offset by `shakeOffset` (hug only) |

All lerp smoothly. No thresholds. `sanityFloat = 0` means no effects visible.

---

## Hug Sequence State Machine

Triggered when `nikoState === 'hugging'` is received. PostProcessing takes camera ownership from PlayerController for the duration. PlayerController is frozen.

```
idle
  ↓ nikoState === 'hugging'
lookAt      — camera lerps toward nikoPosition over ~0.4s
  ↓ lerp complete
fadeOut     — blackOverlay lerps 0 → 1 over ~0.8s
  ↓ complete
holdBlack   — timer holds ~0.3s
  ↓ complete
blink       — blackOverlay pulses: 1→0→1→0→1, rapid (~0.15s each)
  ↓ complete
shake       — shakeOffset fires a burst, blackOverlay → 0, sanity effects begin lerping down
  ↓ complete
done        — camera released back to PlayerController, state resets to idle
```

### Camera Handoff
- On `lookAt` enter: PostProcessing notifies PlayerController to freeze camera input
- PostProcessing drives camera directly via `camera.lookAt(nikoPosition)` lerp
- On `done`: PostProcessing releases camera, PlayerController resumes

---

## Inputs

| Input | From | Used For |
|---|---|---|
| `sanityFloat` | SanitySystem | Full effect stack |
| `nikoState` | PlayerController | Trigger hug sequence |
| `nikoPosition` | PlayerController | Camera lerp target during hug |
| `gameState` | GameStateMachine | Guard — effects only active in `ACTIVE` |
| `delta` | Render loop | Lerps, timers, `time` accumulation |

---

## Outputs

| Output | To | When |
|---|---|---|
| Camera freeze/release signal | PlayerController | On hug sequence enter/exit |

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Hug sequence triggered mid-sequence | Guard: `if (hugState !== 'idle') return` — ignore re-trigger |
| `gameState` changes mid-hug | Cut immediately to `done`, release camera, reset all uniforms |
| `blackOverlay` and `sanityFloat` effects fighting | `blackOverlay` is additive on top — not competing with sanity uniforms |
| Screen shake amplitude too high → motion sickness | Hard cap on `shakeOffset` magnitude |
| `time` uniform overflows on long sessions | Wrap `time` at a safe modulo (e.g. 1000.0) |
| Camera lerp in `lookAt` overshoots Niko | Clamp lerp, check arrival threshold before transitioning state |
