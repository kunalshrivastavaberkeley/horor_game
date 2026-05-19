# Main Wiring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the three remaining gaps so all 10 systems are fully connected and the game loop runs end-to-end.

**Architecture:** All system files are done. The work is (a) un-stubbing two small functions whose comments say "until X is built" — X is now built — and (b) rewriting main.js to instantiate every system, wire all cross-system callbacks, and add a per-frame coordinator for data flows the GSM loop can't handle natively.

**Tech Stack:** Three.js, Cannon.js, Vite, Vanilla JS (no framework)

---

## Gap 1 — SanitySystem.js: un-stub proxRateFn

### Task 1: Un-stub proxRateFn in SanitySystem.js

**Files:**
- Modify: `src/systems/SanitySystem.js:27-30`

**Step 1: Apply the fix**

Replace:
```js
function proxRateFn(_constants) {
  // Stub until EnemySystem is built — always returns 0
  return (_factor) => 0
}
```

With:
```js
function proxRateFn(constants) {
  return (factor) => constants.maxRate * factor
}
```

`PROX_MAX_RATE = -0.15`, so at `factor=1` (enemy right on top of player) the drain is −0.15/s. At `factor=0` (enemy at detection range edge) it is 0. Linear scale exactly as spec describes.

**Step 2: Commit**
```
git add src/systems/SanitySystem.js
git commit -m "fix: SanitySystem — un-stub proxRateFn now EnemySystem is built"
```

---

## Gap 2 — PlayerCollision.js: 4 → 8 wall-blocking directions

### Task 2: Add diagonal raycasts to PlayerCollision.js

**Files:**
- Modify: `src/systems/PlayerCollision.js:71-76`

**Step 1: Apply the fix**

Replace the 4-direction array with 8:
```js
const INV_SQRT2 = 1 / Math.sqrt(2)
const dirs = [
  new THREE.Vector3(1,         0, 0),
  new THREE.Vector3(-1,        0, 0),
  new THREE.Vector3(0,         0, 1),
  new THREE.Vector3(0,         0, -1),
  new THREE.Vector3(INV_SQRT2, 0,  INV_SQRT2),
  new THREE.Vector3(-INV_SQRT2, 0, INV_SQRT2),
  new THREE.Vector3(INV_SQRT2, 0, -INV_SQRT2),
  new THREE.Vector3(-INV_SQRT2, 0,-INV_SQRT2),
]
```

The constant is computed once per `_wallBlock` call; vectors are pre-normalized (magnitude = 1). The dot-product blocking logic at line 84 works identically for diagonal rays.

**Step 2: Commit**
```
git add src/systems/PlayerCollision.js
git commit -m "fix: PlayerCollision — 8-direction wall blocking per spec (was 4)"
```

---

## Gap 3 — main.js: complete system wiring

### Task 3: Rewrite main.js

**Files:**
- Modify: `src/main.js`

This is the main work. The rewrite must:
1. Import all 10 system classes
2. Instantiate them in dependency order
3. Wire all cross-system callbacks
4. Register a per-frame coordinator to handle data flows that need player position (not delta)
5. Sequence async initialization (ZoneSystem.load is async; scene load fires a callback)

**Step 1: Write the new main.js**

```js
import * as THREE from 'three'
import { GameStateMachine } from './GameStateMachine/index.js'
import { SceneManagement } from './systems/SceneManagement.js'
import { PlayerController } from './systems/PlayerController.js'
import { ZoneSystem } from './systems/ZoneSystem.js'
import { ZoneEditor } from './systems/ZoneEditor.js'
import { SanitySystem } from './systems/SanitySystem.js'
import { AudioManager } from './systems/AudioManager.js'
import { LightingSystem } from './systems/LightingSystem.js'
import { EnemySystem } from './systems/EnemySystem.js'
import { TriggerSystem } from './systems/TriggerSystem.js'
import { PostProcessing } from './systems/PostProcessing.js'

// Seconds between footstep sounds when walking
const FOOTSTEP_INTERVAL = 0.45

// Exit trigger AABB — conservative placement at far end of temple stub
const EXIT_BOX = new THREE.Box3(
  new THREE.Vector3(70, -2, -15),
  new THREE.Vector3(90, 10,  15)
)

async function main() {
  const gsm = new GameStateMachine()

  // ── Audio: preload immediately (buffers load in background after first click) ──
  const audioManager = new AudioManager()
  audioManager.preload()
  gsm.registerSystem('audio', audioManager)

  // ── Zone data: load async ────────────────────────────────────────────────────
  const zoneSystem = new ZoneSystem()

  // ── Scene: wrap callback in a promise so we can await both in parallel ───────
  let sceneReadyResolve
  const sceneReady = new Promise(r => { sceneReadyResolve = r })
  const sceneManagement = new SceneManagement(gsm.scene, sceneReadyResolve)
  gsm.registerSystem('scene', sceneManagement)
  sceneManagement.loadStub()   // swap to .load(desertPath, templePath) when assets exist

  // Wait for zones + scene in parallel
  await Promise.all([zoneSystem.load(), sceneReady])

  // ── Player controller ────────────────────────────────────────────────────────
  const playerController = new PlayerController(sceneManagement, gsm)
  gsm.registerSystem('player', playerController)

  // ── Sanity system ────────────────────────────────────────────────────────────
  const sanitySystem = new SanitySystem(gsm)
  gsm.registerSystem('sanity', sanitySystem)

  // ── Lighting: init with zone data ────────────────────────────────────────────
  const lightingSystem = new LightingSystem(gsm.scene, gsm)
  lightingSystem.init(zoneSystem.zones)
  gsm.registerSystem('lighting', lightingSystem)

  // ── Enemy system: init after scene is ready (needs mesh refs) ────────────────
  const enemySystem = new EnemySystem(gsm.scene, sceneManagement, gsm)
  enemySystem.init()
  gsm.registerSystem('enemy', enemySystem)

  // ── Trigger system: register exit zone ───────────────────────────────────────
  const triggerSystem = new TriggerSystem()
  triggerSystem.registerTrigger(EXIT_BOX, () => gsm.onExitReached(), 'exit')

  // ── Post-processing ──────────────────────────────────────────────────────────
  const postProcessing = new PostProcessing(gsm.renderer, gsm.scene, gsm.camera, gsm)
  postProcessing.setPlayerController(playerController)
  gsm.setPostProcessing(postProcessing)

  // ── Zone editor (dev tool — zero-cost when DEV_MODE=false) ───────────────────
  // eslint-disable-next-line no-unused-vars
  const zoneEditor = new ZoneEditor(gsm.renderer, gsm.scene)

  // ── Cross-system callback wiring ─────────────────────────────────────────────

  // Niko state → Sanity + PostProcessing + Audio
  playerController.onNikoStateChange = (state) => {
    sanitySystem.onNikoStateChange(state)
    postProcessing.onNikoStateChange(state, playerController.nikoPosition)
    if (state === 'hugging') audioManager.playNikoHug()
    else                     audioManager.playNikoPutdown()
  }

  // Artifact pickup → Enemy activation + UI sound
  playerController.onArtifactPickedUp = () => {
    enemySystem.onArtifactPickedUp()
    audioManager.playUIButton()
  }

  // Pointer lock lost → GSM
  playerController.onPause = () => gsm.onPause()

  // Zone darkness change → Sanity
  zoneSystem.onDarknessChange = (isDark) => sanitySystem.onDarknessChange(isDark)

  // Scene zone change → Lighting + PlayerController zone hint
  zoneSystem.onSceneZoneChange = (zone) => {
    lightingSystem.onSceneZoneChange(zone)
    playerController.setZone(zone)
  }

  // Enemy proximity → Sanity
  enemySystem.onEnemyProximityChange = (factor) => sanitySystem.onEnemyProximityChange(factor)

  // ── Per-frame coordinator ─────────────────────────────────────────────────────
  // ZoneSystem.update and TriggerSystem.update take player position, not delta —
  // they cannot be registered directly with the GSM system loop.
  // This coordinator is registered last so all other systems have already updated.
  let footstepTimer = 0

  const coordinator = {
    update(delta) {
      if (!gsm.isActive) return
      const pos = playerController.playerPosition

      zoneSystem.update(pos)
      triggerSystem.update(pos)

      enemySystem.setPlayerPosition(pos)
      enemySystem.setPlayerLightLevel(zoneSystem.getPlayerLightLevel(pos.x, pos.z))

      audioManager.onSanityChange(sanitySystem.getSanity())

      // Footsteps — driven from movement state, not from PlayerController internals
      if (playerController.movementState === 'walking') {
        footstepTimer -= delta
        if (footstepTimer <= 0) {
          audioManager.playFootstep()
          footstepTimer = FOOTSTEP_INTERVAL
        }
      } else {
        footstepTimer = 0
      }
    }
  }
  gsm.registerSystem('coordinator', coordinator)

  // ── Start ────────────────────────────────────────────────────────────────────
  console.log('[main] All systems initialized — starting game')
  gsm.start()
}

main().catch(err => {
  console.error('[main] Initialization failed:', err)
})
```

**Step 2: Commit**
```
git add src/main.js
git commit -m "feat: main.js — wire all 10 systems, cross-system callbacks, coordinator"
```

---

## Verification

After all three tasks:

1. `npm run dev` — Vite server starts, no import errors in console
2. Browser: click "PRESS TO START" — game transitions through INTRO → DESERT
3. Console shows:
   - `[ZoneSystem] Loaded N zones` (or warning if zones.json missing — graceful)
   - `[LightingSystem] Initialized — N static point lights`
   - `[main] All systems initialized — starting game`
   - `[GSM] → START` → `[GSM] → INTRO` → `[GSM] → DESERT`
4. WASD moves the player, mouse look works (after clicking to lock pointer)
5. Press E near artifact position (55, 1, 0) → `[EnemySystem] Snake activated`
6. Press E again → niko hug sound, screen effects begin
7. Let sanity drain to 0 → `[GSM] → END` with game over overlay

---

## Decision log

| Decision | Rationale |
|---|---|
| Exit trigger box at X=70–90 | Temple stub is at X=50, 30 units wide — exit is the far wall |
| `playUIButton()` for artifact pickup | No dedicated artifact sound in spec; UI button is the closest one-shot sound |
| Footstep timer resets to 0 on idle | Prevents partial-interval double-step on walk→idle→walk |
| ZoneSystem not registered directly with GSM | Its `update(playerPosition)` signature conflicts with the GSM loop's `update(delta)` |
| Coordinator registered last | Ensures PlayerController.playerPosition is already updated before zone/trigger/enemy queries |
