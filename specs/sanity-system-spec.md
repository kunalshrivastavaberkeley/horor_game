# SanitySystem — Implementation Spec

## Overview

SanitySystem owns a single float (`sanity`, 0–1) and updates it every frame based on three independent rate contributors: Niko's current state, whether the player is in a shadow zone, and enemy proximity. Each contributor is a curried function — constants are baked in at construction time, runtime values are passed each frame. The three contributions are summed and applied to `sanity` each frame. When sanity reaches 0 and stays there for `DEPLETION_HOLD_MS`, the system fires `onSanityDepleted` to GameStateMachine.

---

## Curried Rate Functions

Each rate function is constructed once at init with its tunable constants. At runtime, it receives only the current state value and returns a delta contribution.

```
nikoRateFn   = (constants) => (nikoState) => number
darkRateFn   = (constants) => (isDark)    => number
proxRateFn   = (constants) => (factor)    => number
```

Each frame:
```
delta = nikoRateFn(nikoState) + darkRateFn(isDark) + proxRateFn(enemyProximityFactor)
sanity = clamp(sanity + delta * dt, 0, 1)
```

The enemy proximity function is a no-op stub until EnemySystem is built:
```
proxRateFn = (_constants) => (_factor) => 0
```

---

## Constants (all tunable)

| Constant | Value |
|---|---|
| Niko hugging | +0.15 / sec |
| Niko held | +0.02 / sec |
| Niko away | -0.05 / sec |
| In shadow zone | -0.10 / sec |
| In light | +0.00 / sec |
| Enemy proximity max | -0.15 / sec |
| `DEPLETION_HOLD_MS` | 2500 |

---

## Depletion Hold

When `sanity` first reaches 0, a `depletionTimer` starts counting up with `delta`. `onSanityDepleted` fires only after `depletionTimer >= DEPLETION_HOLD_MS`. If sanity recovers above 0 before the timer expires, the timer resets. The hold exists so PostProcessing can run at full max-distortion intensity before the game ends — the player experiences the worst of it before the state transition.

---

## Inputs

| Input | Source | Delivery |
|---|---|---|
| `nikoState` | PlayerController | Event: `onNikoStateChange(state)` |
| `isDark` | ZoneSystem | Event: `onDarknessChange(isDark)` |
| `enemyProximityFactor` | EnemySystem | Event: `onEnemyProximityChange(factor)` — stub, defaults to 0 |
| `delta` | Render loop | Called each frame via `update(delta)` |

---

## Outputs

| Output | Consumer | Delivery |
|---|---|---|
| `getSanity()` | PostProcessing | Polled each frame |
| `onSanityDepleted` | GameStateMachine | Fired once after `DEPLETION_HOLD_MS` at sanity 0 |

---

## What SanitySystem Owns

- `sanity` float (0–1), internal, not exposed for external write
- Current `nikoState` — updated on event
- Current `isDark` — updated on event
- Current `enemyProximityFactor` — updated on event, defaults to 0
- Three curried rate functions with constants baked at construction
- `depletionTimer` accumulator

## What SanitySystem Does NOT Own

- Visual effects — PostProcessing reads `getSanity()` and owns all rendering
- What happens after depletion — GameStateMachine owns the end state transition
- Enemy proximity value — EnemySystem owns and emits that when built
- Niko light radius or visibility — LightingSystem owns that

---

## Dependencies

| Dependency | What For |
|---|---|
| PlayerController | Source of `nikoState` events |
| ZoneSystem | Source of `isDark` events |
| EnemySystem | Source of `enemyProximityFactor` (stub until built) |
| GameStateMachine | Receives `onSanityDepleted`; SanitySystem only ticks during `ACTIVE` state |

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| `depletionTimer` resets repeatedly if sanity oscillates at 0 | Timer resets only on recovery above 0, not on re-entry — if sanity stays at 0 continuously, timer runs uninterrupted |
| `onEnemyProximityChange` called before EnemySystem is ready | Stub `proxRateFn` returns 0 regardless of input — no contribution until replaced |
| Rate functions called with unexpected / undefined state | Each curried function guards with a default fallback — unknown `nikoState` returns 0 |
| SanitySystem ticking outside `ACTIVE` state | `update(delta)` is a no-op unless `gameState === 'ACTIVE'` — GSM controls tick lifecycle |
| `onSanityDepleted` fires more than once | One-shot flag — once fired, event is disabled for the remainder of the session |
