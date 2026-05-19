# Horror Game Full Build — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Three.js + Cannon.js + Vite horror game with GameStateMachine, scene management, collision, player controller, zone system, sanity, audio, lighting, enemy, and post-processing.

**Architecture:** Vite dev server, vanilla JS, Three.js for rendering, cannon-es for physics. GameStateMachine is the root orchestrator; all other systems are classes under `/src/systems/`. Entry point `main.js` instantiates only GameStateMachine.

**Tech Stack:** Three.js, cannon-es, Vite, vanilla JS (no framework), three/examples/jsm for EffectComposer + GLTFLoader.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/main.js`
- Create: `data/zones.json`
- Create: `public/audio/.gitkeep`

**Step 1: Create package.json**
```json
{
  "name": "horror-game",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.165.0",
    "cannon-es": "^0.20.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create vite.config.js**
```js
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    {
      name: 'zone-editor-save',
      configureServer(server) {
        server.middlewares.use('/dev/save-zones', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const zones = JSON.parse(body)
              const outPath = path.resolve(__dirname, 'data/zones.json')
              fs.writeFile(outPath, JSON.stringify(zones, null, 2), err => {
                if (err) { res.statusCode = 500; res.end('write failed'); return }
                res.statusCode = 200
                res.end('ok')
              })
            } catch (e) {
              res.statusCode = 400; res.end('bad json')
            }
          })
        })
      }
    }
  ]
})
```

**Step 3: Create index.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Horror Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

**Step 4: Create src/main.js**
```js
import { GameStateMachine } from './GameStateMachine/index.js'

const gsm = new GameStateMachine()
gsm.start()
```

**Step 5: Create data/zones.json**
```json
[]
```

**Step 6: Run npm install**
Run: `cd "C:/Users/kunal/OneDrive/Desktop/Horror/horor_game" && npm install`
Expected: node_modules created, no errors.

**Step 7: Commit**
```bash
git add package.json vite.config.js index.html src/main.js data/zones.json
git commit -m "feat: project scaffold — vite + three.js + cannon-es"
```

---

### Task 2: GameStateMachine

**Files:**
- Create: `src/GameStateMachine/index.js`
- Create: `src/GameStateMachine/flow/StartState.js`
- Create: `src/GameStateMachine/flow/IntroState.js`
- Create: `src/GameStateMachine/flow/DesertState.js`
- Create: `src/GameStateMachine/flow/TempleState.js`
- Create: `src/GameStateMachine/flow/ExitState.js`
- Create: `src/GameStateMachine/flow/EndState.js`
- Create: `src/GameStateMachine/utilities/SettingsState.js`
- Create: `src/GameStateMachine/utilities/settings/VideoState.js`
- Create: `src/GameStateMachine/utilities/settings/AudioState.js`

**Step 1: Create flow state base structure**

Each flow state implements: `enter(gsm)`, `update(gsm, delta)`, `exit(gsm)`.

**StartState.js:**
```js
// Enter: Show start screen overlay, listen for click/keypress
// Running: Wait for user interaction
// Exit: Fade out overlay, fire sceneReady check

export class StartState {
  enter(gsm) {
    gsm.renderer.domElement.style.opacity = '1'
    this._overlay = document.createElement('div')
    Object.assign(this._overlay.style, {
      position: 'fixed', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: '#000', color: '#fff', fontSize: '2rem',
      cursor: 'pointer', zIndex: '100'
    })
    this._overlay.textContent = 'PRESS TO START'
    document.body.appendChild(this._overlay)
    this._onClick = () => gsm.transition('INTRO')
    this._overlay.addEventListener('click', this._onClick)
  }

  update(_gsm, _delta) {}

  exit(gsm) {
    this._overlay.removeEventListener('click', this._onClick)
    this._overlay.remove()
  }
}
```

**IntroState.js:**
```js
// Enter: Systems spin up, cutscene placeholder, player frozen
// Running: Wait for intro to complete (timeout or skip)
// Exit: Fade transition, hand off to DesertState
export class IntroState {
  enter(gsm) {
    // Stub: auto-advance after 500ms so game is playable immediately
    this._timer = setTimeout(() => gsm.transition('DESERT'), 500)
  }
  update(_gsm, _delta) {}
  exit(_gsm) { clearTimeout(this._timer) }
}
```

**DesertState.js, TempleState.js, ExitState.js** — all activate player, mark ACTIVE:
```js
export class DesertState {
  enter(gsm) { gsm.setGameActive(true) }
  update(_gsm, _delta) {}
  exit(gsm) { gsm.setGameActive(false) }
}
```

**EndState.js** — shows end screen, restart option:
```js
export class EndState {
  enter(gsm) {
    gsm.setGameActive(false)
    this._overlay = document.createElement('div')
    Object.assign(this._overlay.style, {
      position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: '2rem', zIndex: '100'
    })
    this._overlay.innerHTML = '<div>GAME OVER</div><button id="restart" style="margin-top:1rem;font-size:1rem;padding:.5rem 1.5rem">Restart</button>'
    document.body.appendChild(this._overlay)
    document.getElementById('restart').addEventListener('click', () => location.reload())
  }
  update(_gsm, _delta) {}
  exit(_gsm) { this._overlay?.remove() }
}
```

**Step 2: Create GameStateMachine/index.js**
```js
import * as THREE from 'three'
import { StartState } from './flow/StartState.js'
import { IntroState } from './flow/IntroState.js'
import { DesertState } from './flow/DesertState.js'
import { TempleState } from './flow/TempleState.js'
import { ExitState } from './flow/ExitState.js'
import { EndState } from './flow/EndState.js'
import { SettingsState } from './utilities/SettingsState.js'

const STATES = {
  START: StartState,
  INTRO: IntroState,
  DESERT: DesertState,
  TEMPLE: TempleState,
  EXIT: ExitState,
  END: EndState,
  SETTINGS: SettingsState,
}

export class GameStateMachine {
  constructor() {
    // Renderer init — once, at boot
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    document.getElementById('app').appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

    this.currentStateName = null
    this.currentState = null
    this.isActive = false // true during DESERT/TEMPLE/EXIT

    // Systems (set by external code after construction)
    this.systems = {}

    this._clock = new THREE.Clock()
    this._animId = null

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  registerSystem(name, system) {
    this.systems[name] = system
  }

  start() {
    this.transition('START')
    this._loop()
  }

  transition(stateName) {
    if (!STATES[stateName]) { console.error(`Unknown state: ${stateName}`); return }
    if (this.currentState?.exit) this.currentState.exit(this)
    this.currentStateName = stateName
    this.currentState = new STATES[stateName]()
    this.currentState.enter(this)
  }

  setGameActive(val) {
    this.isActive = val
  }

  // Called by SanitySystem
  onSanityDepleted() {
    this.transition('END')
  }

  // Called by TriggerSystem (exit zone)
  onExitReached() {
    this.transition('END')
  }

  // Called by EnemySystem
  onPlayerCaught() {
    this.transition('END')
  }

  // Called by PlayerController (pointer lock lost)
  onPause() {
    // Conservative stub — store previous state, move to settings-like pause
    // Decision: for now just note it; full pause is out of scope per spec
    console.log('[GSM] pause requested — pointer lock lost')
  }

  setCamera(cam) {
    this.camera = cam
  }

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop())
    const delta = this._clock.getDelta()

    // Tick current state
    if (this.currentState?.update) this.currentState.update(this, delta)

    // Tick all registered systems (only active-aware systems tick themselves)
    for (const sys of Object.values(this.systems)) {
      if (sys.update) sys.update(delta)
    }

    this.renderer.render(this.scene, this.camera)
  }
}
```

**Step 3: Create utility states (stubs)**
```js
// SettingsState.js
export class SettingsState {
  enter(_gsm) { console.log('[Settings] enter') }
  update(_gsm, _delta) {}
  exit(_gsm) { console.log('[Settings] exit') }
}
```

**Step 4: Verify dev server starts**
Run: `cd "C:/Users/kunal/OneDrive/Desktop/Horror/horor_game" && npm run dev`
Expected: Vite dev server starts, browser shows black screen with "PRESS TO START" text.

**Step 5: Commit**
```bash
git add src/GameStateMachine/
git commit -m "feat: GameStateMachine — state machine, renderer init, render loop"
```

---

### Task 3: SceneManagement

**Files:**
- Create: `src/systems/SceneManagement.js`

**Step 1: Implement SceneManagement**
```js
// src/systems/SceneManagement.js
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'

// Tunable constants
const DESERT_POSITION = new THREE.Vector3(0, 0, 0)
const TEMPLE_POSITION = new THREE.Vector3(50, 0, 0)
const DESERT_PHYSICS_MASS = 0
const TEMPLE_PHYSICS_MASS = 0

export class SceneManagement {
  constructor(scene, onSceneReady) {
    this._scene = scene
    this._onSceneReady = onSceneReady
    this._ready = false

    this._physicsWorld = new CANNON.World()
    this._physicsWorld.gravity.set(0, -9.82, 0)
    this._physicsWorld.broadphase = new CANNON.NaiveBroadphase()

    this._desertMesh = null
    this._templeMesh = null
    this._desertBody = null
    this._templeBody = null

    this._artifactPosition = new THREE.Vector3(55, 1, 0) // default; tune in-engine
  }

  load(desertPath, templePath) {
    const loader = new GLTFLoader()
    let desertLoaded = false
    let templeLoaded = false

    const checkReady = () => {
      if (desertLoaded && templeLoaded) {
        this._ready = true
        this._onSceneReady()
      }
    }

    loader.load(
      desertPath,
      (gltf) => {
        this._desertMesh = gltf.scene
        this._desertMesh.position.copy(DESERT_POSITION)
        this._scene.add(this._desertMesh)
        this._buildDesertPhysics(gltf)
        desertLoaded = true
        checkReady()
      },
      undefined,
      (err) => { console.error('[SceneManagement] Desert load failed:', err) }
    )

    loader.load(
      templePath,
      (gltf) => {
        this._templeMesh = gltf.scene
        this._templeMesh.position.copy(TEMPLE_POSITION)
        this._scene.add(this._templeMesh)
        this._buildTemplePhysics(gltf)
        templeLoaded = true
        checkReady()
      },
      undefined,
      (err) => { console.error('[SceneManagement] Temple load failed:', err) }
    )
  }

  // Stubs — no assets yet; allow game to proceed
  loadStub() {
    // Create placeholder ground plane for dev
    const geo = new THREE.PlaneGeometry(200, 200)
    const mat = new THREE.MeshStandardMaterial({ color: 0x888866 })
    this._desertMesh = new THREE.Mesh(geo, mat)
    this._desertMesh.rotation.x = -Math.PI / 2
    this._desertMesh.position.copy(DESERT_POSITION)
    this._scene.add(this._desertMesh)

    const templeGeo = new THREE.BoxGeometry(20, 5, 20)
    const templeMat = new THREE.MeshStandardMaterial({ color: 0x555544 })
    this._templeMesh = new THREE.Mesh(templeGeo, templeMat)
    this._templeMesh.position.copy(TEMPLE_POSITION)
    this._scene.add(this._templeMesh)

    // Simple ground physics plane
    const groundBody = new CANNON.Body({ mass: DESERT_PHYSICS_MASS })
    groundBody.addShape(new CANNON.Plane())
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this._physicsWorld.addBody(groundBody)
    this._desertBody = groundBody

    this._ready = true
    this._onSceneReady()
  }

  _buildDesertPhysics(_gltf) {
    // Decision: use trimesh from first found mesh in GLTF
    // For now — ground plane fallback (trimesh is slow; plane is fine for flat desert)
    const body = new CANNON.Body({ mass: DESERT_PHYSICS_MASS })
    body.addShape(new CANNON.Plane())
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this._physicsWorld.addBody(body)
    this._desertBody = body
  }

  _buildTemplePhysics(gltf) {
    // Build trimesh from GLTF geometry
    gltf.scene.traverse(child => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry
        if (!geo.index) return
        const pos = geo.attributes.position.array
        const idx = geo.index.array
        const verts = Array.from(pos)
        const faces = Array.from(idx)
        const shape = new CANNON.Trimesh(verts, faces)
        const body = new CANNON.Body({ mass: TEMPLE_PHYSICS_MASS })
        body.addShape(shape)
        body.position.copy(TEMPLE_POSITION)
        this._physicsWorld.addBody(body)
        this._templeBody = body
      }
    })
  }

  _assertReady() {
    if (!this._ready) throw new Error('[SceneManagement] Accessed before onSceneReady fired')
  }

  getScene() { this._assertReady(); return this._scene }
  getPhysicsWorld() { this._assertReady(); return this._physicsWorld }
  getDesertMesh() { this._assertReady(); return this._desertMesh }
  getTempleMesh() { this._assertReady(); return this._templeMesh }
  getArtifactPosition() { return this._artifactPosition }

  update(delta) {
    if (!this._ready) return
    this._physicsWorld.step(1 / 60, delta, 3)
  }
}
```

**Step 2: Wire SceneManagement into GSM — update main.js**
```js
import { GameStateMachine } from './GameStateMachine/index.js'
import { SceneManagement } from './systems/SceneManagement.js'

const gsm = new GameStateMachine()
const scene = gsm.systems.scene = new SceneManagement(gsm.scene, () => {
  console.log('[Scene] ready')
})
scene.loadStub() // Use stub until GLTF assets exist
gsm.start()
```

**Step 3: Commit**
```bash
git add src/systems/SceneManagement.js src/main.js
git commit -m "feat: SceneManagement — physics world, GLTF loader, stub mode"
```

---

### Task 4: Collision Systems

**Files:**
- Create: `src/systems/PlayerCollision.js`
- Create: `src/systems/SnakeCollision.js`
- Create: `src/systems/LineOfSight.js`
- Create: `src/systems/TriggerSystem.js`

**Step 1: PlayerCollision.js**
```js
// src/systems/PlayerCollision.js
import * as THREE from 'three'

// Tunable constants
const CAPSULE_RADIUS = 0.4
const CAPSULE_HEIGHT = 1.8
const CAPSULE_CROUCH_HEIGHT = 1.0
const WALL_RAY_DISTANCE = CAPSULE_RADIUS + 0.05
const GROUND_RAY_MAX = 5
const MIN_FLOOR_Y = 0
const WALL_DIRECTIONS_COUNT = 4 // cardinal: N E S W

export class PlayerCollision {
  constructor(desertMesh, templeMesh) {
    this._desertMesh = desertMesh
    this._templeMesh = templeMesh
    this._raycaster = new THREE.Raycaster()
    this._lastGroundY = 0
    this._isCrouching = false
    this._isGrounded = false
  }

  setCrouch(val) { this._isCrouching = val }

  /**
   * @param {THREE.Vector3} position - current player position
   * @param {THREE.Vector3} intendedMove - desired movement delta this frame
   * @param {string} zone - 'desert' | 'temple'
   * @returns {{ resolvedMove: THREE.Vector3, groundY: number, isGrounded: boolean }}
   */
  resolve(position, intendedMove, zone) {
    const groundY = this._groundRaycast(position, zone)
    const resolvedMove = this._wallBlock(position, intendedMove, zone)
    return { resolvedMove, groundY, isGrounded: this._isGrounded }
  }

  _groundRaycast(position, zone) {
    const capsuleHeight = this._isCrouching ? CAPSULE_CROUCH_HEIGHT : CAPSULE_HEIGHT
    const origin = new THREE.Vector3(position.x, position.y + capsuleHeight * 0.5, position.z)
    this._raycaster.set(origin, new THREE.Vector3(0, -1, 0))
    this._raycaster.far = GROUND_RAY_MAX

    const meshes = this._getMeshes(zone)
    const hits = this._raycaster.intersectObjects(meshes, true)

    if (hits.length > 0) {
      this._lastGroundY = hits[0].point.y
      this._isGrounded = true
    } else {
      this._isGrounded = false
      // Fallback to last known good Y, clamp to minimum
      this._lastGroundY = Math.max(this._lastGroundY, MIN_FLOOR_Y)
    }
    return this._lastGroundY
  }

  _wallBlock(position, intendedMove, zone) {
    if (intendedMove.lengthSq() < 0.0001) return intendedMove.clone()

    const capsuleHeight = this._isCrouching ? CAPSULE_CROUCH_HEIGHT : CAPSULE_HEIGHT
    const origin = new THREE.Vector3(position.x, position.y + capsuleHeight * 0.5, position.z)
    const meshes = this._getMeshes(zone)

    const resolved = intendedMove.clone()
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]

    for (const dir of dirs) {
      this._raycaster.set(origin, dir)
      this._raycaster.far = WALL_RAY_DISTANCE
      const hits = this._raycaster.intersectObjects(meshes, true)
      if (hits.length > 0) {
        // Block component of movement along this direction
        const dot = resolved.dot(dir)
        if (dot > 0) resolved.addScaledVector(dir, -dot)
      }
    }

    return resolved
  }

  _getMeshes(zone) {
    const out = []
    if (this._desertMesh) out.push(this._desertMesh)
    if (this._templeMesh) out.push(this._templeMesh)
    return out
  }
}
```

**Step 2: SnakeCollision.js**
```js
// src/systems/SnakeCollision.js
import * as THREE from 'three'

// Tunable constants
const TRANSITION_ANGLE_THRESHOLD = Math.PI / 3 // ~60 degrees
const TRANSITION_LERP_RATE = 0.05
const RAYCAST_DISTANCE = 2.0
const FLOOR_ANGLE = Math.PI / 6        // < 30° from up = floor
const CEILING_ANGLE = (5 * Math.PI) / 6 // > 150° from up = ceiling

const UP = new THREE.Vector3(0, 1, 0)

const DIRECTIONS = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
]

export class SnakeCollision {
  constructor(templeMesh, desertMesh) {
    this._templeMesh = templeMesh
    this._desertMesh = desertMesh
    this._raycaster = new THREE.Raycaster()

    this.currentSurfaceNormal = new THREE.Vector3(0, 1, 0)
    this.nearestSurfaces = []
    this.approachingTransition = false
    this.targetTransitionNormal = new THREE.Vector3(0, 1, 0)
  }

  update(snakePosition, snakeForward) {
    const meshes = [this._templeMesh, this._desertMesh].filter(Boolean)
    this.nearestSurfaces = []

    for (const dir of DIRECTIONS) {
      this._raycaster.set(snakePosition, dir)
      this._raycaster.far = RAYCAST_DISTANCE
      const hits = this._raycaster.intersectObjects(meshes, true)
      if (hits.length > 0) {
        const h = hits[0]
        this.nearestSurfaces.push({ dir, distance: h.distance, normal: h.face.normal.clone() })
      }
    }

    // Update current surface normal from downward-ish ray
    const downHit = this.nearestSurfaces.find(s => s.dir.y < -0.5)
    if (downHit) {
      this.currentSurfaceNormal.lerp(downHit.normal, TRANSITION_LERP_RATE)
    }

    // Detect forward transition
    const fwdHit = this.nearestSurfaces.find(s => {
      const dot = s.dir.dot(snakeForward)
      return dot > 0.5
    })
    if (fwdHit) {
      const angleDelta = this.currentSurfaceNormal.angleTo(fwdHit.normal)
      if (angleDelta > TRANSITION_ANGLE_THRESHOLD) {
        this.approachingTransition = true
        this.targetTransitionNormal.copy(fwdHit.normal)
      } else {
        this.approachingTransition = false
      }
    } else {
      this.approachingTransition = false
    }
  }
}
```

**Step 3: LineOfSight.js**
```js
// src/systems/LineOfSight.js
import * as THREE from 'three'

export class LineOfSight {
  constructor(templeMesh) {
    this._templeMesh = templeMesh
    this._raycaster = new THREE.Raycaster()
  }

  // Returns true if snake head can see Niko light (no geometry in between)
  check(snakeHeadPosition, nikoLightPosition) {
    const dir = new THREE.Vector3().subVectors(nikoLightPosition, snakeHeadPosition).normalize()
    const dist = snakeHeadPosition.distanceTo(nikoLightPosition)
    this._raycaster.set(snakeHeadPosition, dir)
    this._raycaster.far = dist

    const meshes = this._templeMesh ? [this._templeMesh] : []
    const hits = this._raycaster.intersectObjects(meshes, true)
    return hits.length === 0
  }
}
```

**Step 4: TriggerSystem.js**
```js
// src/systems/TriggerSystem.js
import * as THREE from 'three'

export class TriggerSystem {
  constructor() {
    this._triggers = [] // { box: THREE.Box3, callback: fn, wasInside: false }
  }

  /**
   * Register a trigger volume.
   * @param {THREE.Box3} box - axis-aligned bounding box in world space
   * @param {Function} callback - fired once on entry
   */
  registerTrigger(box, callback) {
    this._triggers.push({ box, callback, wasInside: false })
  }

  /**
   * Call each frame with the player's world position.
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
    for (const trigger of this._triggers) {
      const isInside = trigger.box.containsPoint(playerPosition)
      if (isInside && !trigger.wasInside) {
        trigger.callback()
      }
      trigger.wasInside = isInside
    }
  }
}
```

**Step 5: Commit**
```bash
git add src/systems/PlayerCollision.js src/systems/SnakeCollision.js src/systems/LineOfSight.js src/systems/TriggerSystem.js
git commit -m "feat: collision systems — PlayerCollision, SnakeCollision, LineOfSight, TriggerSystem"
```

---

### Task 5: PlayerController

**Files:**
- Create: `src/systems/PlayerController.js`

**Step 1: Implement PlayerController**
```js
// src/systems/PlayerController.js
import * as THREE from 'three'
import { PlayerCollision } from './PlayerCollision.js'

// Tunable constants
const MOVE_SPEED = 5.0
const MOUSE_SENSITIVITY = 0.002
const ARTIFACT_PICKUP_DISTANCE = 2.5
const PITCH_CLAMP = Math.PI / 2 - 0.01

export class PlayerController {
  constructor(sceneManagement, gsm) {
    this._sm = sceneManagement
    this._gsm = gsm

    this.playerPosition = new THREE.Vector3(0, 1, 0)
    this.movementState = 'idle' // 'idle' | 'walking'
    this.nikoState = 'held'    // 'held' | 'hugging'

    this._yaw = 0
    this._pitch = 0
    this._camera = null
    this._collision = null

    this._keys = {}
    this._pointerLocked = false
    this._artifactPickedUp = false
    this._cameraFrozen = false // set by PostProcessing during hug sequence

    this._zone = 'desert'

    // Event callbacks (set externally)
    this.onArtifactPickedUp = null
    this.onPause = null
    this.onNikoStateChange = null

    this._bindInputs()
  }

  setCamera(cam) {
    this._camera = cam
    this._camera.position.copy(this.playerPosition)
    this._collision = new PlayerCollision(
      this._sm.getDesertMesh ? this._sm.getDesertMesh() : null,
      this._sm.getTempleMesh ? this._sm.getTempleMesh() : null
    )
  }

  releaseCamera() {
    this._camera = null
  }

  setZone(zone) { this._zone = zone }

  freezeCamera(val) { this._cameraFrozen = val }

  get nikoPosition() {
    // Niko is held in front of camera — approximate as camera position + slight offset
    if (!this._camera) return this.playerPosition.clone()
    const forward = new THREE.Vector3()
    this._camera.getWorldDirection(forward)
    return this.playerPosition.clone().addScaledVector(forward, 0.5)
  }

  _bindInputs() {
    document.addEventListener('keydown', e => { this._keys[e.code] = true })
    document.addEventListener('keyup', e => {
      this._keys[e.code] = false
      if (e.code === 'KeyE') this._toggleNiko()
    })
    document.addEventListener('mousemove', e => {
      if (!this._pointerLocked || this._cameraFrozen) return
      this._yaw -= e.movementX * MOUSE_SENSITIVITY
      this._pitch -= e.movementY * MOUSE_SENSITIVITY
      this._pitch = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this._pitch))
    })
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = !!document.pointerLockElement
      if (!this._pointerLocked && this._gsm.isActive) {
        this.onPause?.()
      }
    })
    document.addEventListener('click', () => {
      if (this._gsm.isActive && !this._pointerLocked) {
        document.body.requestPointerLock()
      }
    })
  }

  _toggleNiko() {
    if (!this._gsm.isActive) return
    if (this.nikoState === 'held') {
      this.nikoState = 'hugging'
      this.onNikoStateChange?.('hugging')
    } else {
      this.nikoState = 'held'
      this.onNikoStateChange?.('held')
    }
  }

  update(delta) {
    if (!this._gsm.isActive || !this._camera) return

    this._updateMovement(delta)
    this._updateCamera()
    this._checkArtifact()
  }

  _updateMovement(delta) {
    if (this.nikoState === 'hugging') {
      this.movementState = 'idle'
      return
    }

    const forward = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw))
    const right = new THREE.Vector3(Math.cos(this._yaw), 0, -Math.sin(this._yaw))

    const move = new THREE.Vector3()
    if (this._keys['KeyW']) move.addScaledVector(forward, 1)
    if (this._keys['KeyS']) move.addScaledVector(forward, -1)
    if (this._keys['KeyA']) move.addScaledVector(right, -1)
    if (this._keys['KeyD']) move.addScaledVector(right, 1)

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * delta)
      this.movementState = 'walking'
    } else {
      this.movementState = 'idle'
    }

    if (this._collision) {
      const { resolvedMove, groundY } = this._collision.resolve(
        this.playerPosition, move, this._zone
      )
      this.playerPosition.add(resolvedMove)
      this.playerPosition.y = groundY + 0.9 // eye height offset
    } else {
      this.playerPosition.add(move)
    }
  }

  _updateCamera() {
    if (this._cameraFrozen) return
    this._camera.position.copy(this.playerPosition)
    this._camera.rotation.order = 'YXZ'
    this._camera.rotation.y = this._yaw
    this._camera.rotation.x = this._pitch
  }

  _checkArtifact() {
    if (this._artifactPickedUp) return
    if (!this._keys['KeyE']) return
    const artifactPos = this._sm.getArtifactPosition?.()
    if (!artifactPos) return
    const dist = this.playerPosition.distanceTo(artifactPos)
    if (dist <= ARTIFACT_PICKUP_DISTANCE) {
      this._artifactPickedUp = true
      this.onArtifactPickedUp?.()
    }
  }
}
```

**Step 2: Wire PlayerController into main.js**
```js
// Add to main.js after gsm.start():
// gsm.systems.player = new PlayerController(scene, gsm)
// Wire up on DESERT state enter via GSM
```

**Step 3: Commit**
```bash
git add src/systems/PlayerController.js
git commit -m "feat: PlayerController — movement, collision, Niko toggle, artifact pickup"
```

---

### Task 6: ZoneSystem + ZoneEditor

**Files:**
- Create: `src/systems/ZoneSystem.js`
- Create: `src/systems/ZoneEditor.js`

**Step 1: ZoneSystem.js**
```js
// src/systems/ZoneSystem.js

const DEV_WARNING = true

export class ZoneSystem {
  constructor() {
    this._zones = []
    this._loaded = false
    this._sceneZone = 'desert'

    // Callbacks
    this.onDarknessChange = null   // (isDark: boolean) => void
    this.onSceneZoneChange = null  // (zone: 'desert' | 'temple') => void
  }

  async load() {
    try {
      const res = await fetch('/data/zones.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      this._zones = await res.json()
      this._loaded = true
    } catch (e) {
      console.warn('[ZoneSystem] Failed to load zones.json — treating all as light:', e)
      this._zones = []
      this._loaded = true
    }
  }

  isDark(x, z) {
    if (!this._loaded) return false
    for (const zone of this._zones) {
      if (zone.layer !== 'dark_zones') continue
      const hw = zone.width / 2
      const hd = zone.depth / 2
      if (x >= zone.x - hw && x <= zone.x + hw &&
          z >= zone.z - hd && z <= zone.z + hd) {
        return zone.flag === 'dark'
      }
    }
    if (DEV_WARNING) console.debug('[ZoneSystem] position outside all dark zones — defaulting to light')
    return false
  }

  getPlayerLightLevel(x, z) {
    return this.isDark(x, z) ? 0 : 1
  }

  update(playerPosition) {
    if (!this._loaded) return

    const dark = this.isDark(playerPosition.x, playerPosition.z)
    // Emit darkness change (consumers track their own previous state)
    this.onDarknessChange?.(dark)

    // Determine scene zone by X position — temple is at X=50
    // Decision: temple boundary at X=40
    const zone = playerPosition.x > 40 ? 'temple' : 'desert'
    if (zone !== this._sceneZone) {
      this._sceneZone = zone
      this.onSceneZoneChange?.(zone)
    }
  }

  get sceneZone() { return this._sceneZone }
  get zones() { return this._zones }
}
```

**Step 2: ZoneEditor.js**
```js
// src/systems/ZoneEditor.js
// Dev-mode only. Zero cost when DEV_MODE=false.
import * as THREE from 'three'

const DEV_MODE = false // Toggle to true during authoring

const LAYER_CONFIG = {
  dark_zones:      { color: 0xff0000, flag: 'dark',  alpha: 0.35 },
  artifact_spawns: { color: 0x0000ff, flag: 'spawn', alpha: 0.35 },
  light_zones:     { color: 0xffff00, flag: 'light', alpha: 0.25 },
  torch_zones:     { color: 0xff8800, flag: 'torch', alpha: 0.35 },
  artifact_zones:  { color: 0x4488ff, flag: 'artifact', alpha: 0.25 },
}

const AABB_EPSILON = 0.01
const RECT_Y = 0.01

export class ZoneEditor {
  constructor(renderer, scene, zoneSystem) {
    this._renderer = renderer
    this._scene = scene
    this._zoneSystem = zoneSystem

    if (!DEV_MODE) return // zero-cost guard

    this._active = false
    this._activeLayer = 'dark_zones'
    this._layerGroups = {}
    this._orthoCamera = null
    this._perspCamera = null

    this._raycaster = new THREE.Raycaster()
    this._mouse = new THREE.Vector2()
    this._drawStart = null
    this._drawMesh = null
    this._selectedMesh = null
    this._isDragging = false
    this._isResizing = false
    this._cornerHandles = []
    this._dragOffset = new THREE.Vector2()
    this._activeCornerIndex = -1
    this._panel = null

    for (const layerName of Object.keys(LAYER_CONFIG)) {
      const group = new THREE.Group()
      group.visible = false
      scene.add(group)
      this._layerGroups[layerName] = group
    }

    this._setupOrthoCamera()
    this._setupUI()
    this._bindEvents()
  }

  toggle() {
    if (!DEV_MODE) return
    this._active ? this._deactivate() : this._activate()
  }

  _activate() {
    this._active = true
    this._layerGroups[this._activeLayer].visible = true
    this._panel.style.display = 'block'
    this._loadZones()
  }

  _deactivate() {
    this._active = false
    for (const g of Object.values(this._layerGroups)) g.visible = false
    this._panel.style.display = 'none'
    this._clearHandles()
    this._selectedMesh = null
  }

  _setupOrthoCamera() {
    const w = window.innerWidth
    const h = window.innerHeight
    const frustum = 50
    this._orthoCamera = new THREE.OrthographicCamera(
      -frustum * w / h, frustum * w / h, frustum, -frustum, 0.1, 1000
    )
    this._orthoCamera.position.set(0, 100, 0)
    this._orthoCamera.lookAt(0, 0, 0)
    this._orthoCamera.up.set(0, 0, -1)
  }

  _setupUI() {
    this._panel = document.createElement('div')
    Object.assign(this._panel.style, {
      position: 'fixed', top: '10px', left: '10px', background: 'rgba(0,0,0,.75)',
      color: '#fff', padding: '10px', zIndex: '200', display: 'none',
      fontFamily: 'monospace', fontSize: '13px', minWidth: '150px'
    })

    const title = document.createElement('div')
    title.textContent = 'Zone Editor'
    title.style.marginBottom = '8px'
    this._panel.appendChild(title)

    this._layerListEl = document.createElement('div')
    for (const name of Object.keys(LAYER_CONFIG)) {
      const btn = document.createElement('div')
      btn.textContent = name
      btn.dataset.layer = name
      btn.style.cursor = 'pointer'
      btn.style.padding = '2px 0'
      btn.addEventListener('click', () => this._setActiveLayer(name))
      this._layerListEl.appendChild(btn)
    }
    this._panel.appendChild(this._layerListEl)

    const saveBtn = document.createElement('button')
    saveBtn.textContent = 'Save'
    saveBtn.style.marginTop = '8px'
    saveBtn.addEventListener('click', () => this._save(saveBtn))
    this._panel.appendChild(saveBtn)

    const delBtn = document.createElement('button')
    delBtn.textContent = 'Delete Selected'
    delBtn.style.marginLeft = '4px'
    delBtn.addEventListener('click', () => this._deleteSelected())
    this._panel.appendChild(delBtn)

    document.body.appendChild(this._panel)
    this._updateLayerHighlight()
  }

  _setActiveLayer(name) {
    for (const [n, g] of Object.entries(this._layerGroups)) g.visible = (n === name && this._active)
    this._activeLayer = name
    this._updateLayerHighlight()
  }

  _updateLayerHighlight() {
    if (!this._layerListEl) return
    for (const el of this._layerListEl.children) {
      el.style.color = el.dataset.layer === this._activeLayer ? '#ff0' : '#fff'
    }
  }

  _bindEvents() {
    const canvas = this._renderer.domElement
    canvas.addEventListener('mousedown', e => this._onMouseDown(e))
    canvas.addEventListener('mousemove', e => this._onMouseMove(e))
    canvas.addEventListener('mouseup', e => this._onMouseUp(e))
    window.addEventListener('keydown', e => { if (e.key === 'Delete') this._deleteSelected() })
    canvas.addEventListener('wheel', e => {
      if (!this._active) return
      const cam = this._orthoCamera
      const scale = 1 + e.deltaY * 0.001
      cam.left *= scale; cam.right *= scale; cam.top *= scale; cam.bottom *= scale
      cam.updateProjectionMatrix()
    })
  }

  _screenToWorld(e) {
    const rect = this._renderer.domElement.getBoundingClientRect()
    this._mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this._raycaster.setFromCamera(this._mouse, this._orthoCamera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const pt = new THREE.Vector3()
    this._raycaster.ray.intersectPlane(plane, pt)
    return pt
  }

  _onMouseDown(e) {
    if (!this._active) return
    const pt = this._screenToWorld(e)

    // Check corner handles first
    for (let i = 0; i < this._cornerHandles.length; i++) {
      const h = this._cornerHandles[i]
      const hPos = new THREE.Vector2(h.position.x, h.position.z)
      if (hPos.distanceTo(new THREE.Vector2(pt.x, pt.z)) < 0.5) {
        this._isResizing = true
        this._activeCornerIndex = i
        return
      }
    }

    // Check existing meshes
    const group = this._layerGroups[this._activeLayer]
    this._raycaster.setFromCamera(this._mouse, this._orthoCamera)
    const hits = this._raycaster.intersectObjects(group.children.filter(c => c.isMesh), false)
    if (hits.length > 0) {
      this._select(hits[0].object)
      this._isDragging = true
      this._dragOffset.set(pt.x - hits[0].object.position.x, pt.z - hits[0].object.position.z)
      return
    }

    // Start draw
    this._deselect()
    this._drawStart = new THREE.Vector2(pt.x, pt.z)
    this._startDrawRect(pt)
  }

  _onMouseMove(e) {
    if (!this._active) return
    const pt = this._screenToWorld(e)

    if (this._drawStart && this._drawMesh) {
      const cx = (this._drawStart.x + pt.x) / 2
      const cz = (this._drawStart.y + pt.z) / 2
      this._drawMesh.position.set(cx, RECT_Y, cz)
      this._drawMesh.scale.set(Math.abs(pt.x - this._drawStart.x) || 0.01, 1, Math.abs(pt.z - this._drawStart.y) || 0.01)
      return
    }

    if (this._isDragging && this._selectedMesh) {
      this._selectedMesh.position.x = pt.x - this._dragOffset.x
      this._selectedMesh.position.z = pt.z - this._dragOffset.y
      this._updateHandles()
      return
    }

    if (this._isResizing && this._selectedMesh && this._activeCornerIndex >= 0) {
      // Resize: corners [NW, NE, SE, SW] in XZ
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]]
      const [sx, sz] = corners[this._activeCornerIndex]
      const cx = this._selectedMesh.position.x
      const cz = this._selectedMesh.position.z
      const newW = Math.abs(pt.x - cx) * 2 || 0.01
      const newD = Math.abs(pt.z - cz) * 2 || 0.01
      this._selectedMesh.scale.x = newW
      this._selectedMesh.scale.z = newD
      this._updateHandles()
    }
  }

  _onMouseUp(_e) {
    if (!this._active) return
    this._isDragging = false
    this._isResizing = false
    this._activeCornerIndex = -1

    if (this._drawStart && this._drawMesh) {
      const mesh = this._drawMesh
      this._drawMesh = null
      this._drawStart = null

      if (!this._overlapCheck(mesh)) {
        this._layerGroups[this._activeLayer].add(mesh)
      } else {
        // Flash red, reject
        mesh.material.color.set(0xff0000)
        setTimeout(() => mesh.geometry.dispose() || mesh.material.dispose(), 300)
      }
    }
  }

  _startDrawRect(pt) {
    const cfg = LAYER_CONFIG[this._activeLayer]
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.alpha, side: THREE.DoubleSide })
    this._drawMesh = new THREE.Mesh(geo, mat)
    this._drawMesh.position.set(pt.x, RECT_Y, pt.z)
    this._scene.add(this._drawMesh)
  }

  _overlapCheck(newMesh) {
    const group = this._layerGroups[this._activeLayer]
    const nBox = new THREE.Box2(
      new THREE.Vector2(newMesh.position.x - newMesh.scale.x / 2 - AABB_EPSILON, newMesh.position.z - newMesh.scale.z / 2 - AABB_EPSILON),
      new THREE.Vector2(newMesh.position.x + newMesh.scale.x / 2 + AABB_EPSILON, newMesh.position.z + newMesh.scale.z / 2 + AABB_EPSILON),
    )
    for (const mesh of group.children) {
      if (!mesh.isMesh) continue
      const eBox = new THREE.Box2(
        new THREE.Vector2(mesh.position.x - mesh.scale.x / 2 - AABB_EPSILON, mesh.position.z - mesh.scale.z / 2 - AABB_EPSILON),
        new THREE.Vector2(mesh.position.x + mesh.scale.x / 2 + AABB_EPSILON, mesh.position.z + mesh.scale.z / 2 + AABB_EPSILON),
      )
      if (nBox.intersectsBox(eBox)) return true
    }
    return false
  }

  _select(mesh) {
    this._deselect()
    this._selectedMesh = mesh
    mesh.material.opacity = Math.min(mesh.material.opacity + 0.2, 1)
    this._spawnHandles(mesh)
  }

  _deselect() {
    if (this._selectedMesh) {
      const cfg = LAYER_CONFIG[this._activeLayer]
      this._selectedMesh.material.opacity = cfg.alpha
      this._selectedMesh = null
    }
    this._clearHandles()
  }

  _spawnHandles(mesh) {
    this._clearHandles()
    const corners = [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]
    for (const [cx, cz] of corners) {
      const hGeo = new THREE.PlaneGeometry(0.4, 0.4)
      hGeo.rotateX(-Math.PI / 2)
      const hMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const h = new THREE.Mesh(hGeo, hMat)
      h.position.set(mesh.position.x + cx * mesh.scale.x, RECT_Y + 0.01, mesh.position.z + cz * mesh.scale.z)
      this._scene.add(h)
      this._cornerHandles.push(h)
    }
  }

  _updateHandles() {
    if (!this._selectedMesh || this._cornerHandles.length < 4) return
    const mesh = this._selectedMesh
    const corners = [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = corners[i]
      this._cornerHandles[i].position.set(
        mesh.position.x + cx * mesh.scale.x, RECT_Y + 0.01, mesh.position.z + cz * mesh.scale.z
      )
    }
  }

  _clearHandles() {
    for (const h of this._cornerHandles) {
      this._scene.remove(h)
      h.geometry.dispose()
      h.material.dispose()
    }
    this._cornerHandles = []
  }

  _deleteSelected() {
    if (!this._selectedMesh) return
    this._layerGroups[this._activeLayer].remove(this._selectedMesh)
    this._selectedMesh.geometry.dispose()
    this._selectedMesh.material.dispose()
    this._clearHandles()
    this._selectedMesh = null
  }

  async _loadZones() {
    try {
      const res = await fetch('/data/zones.json')
      if (!res.ok) return
      const zones = await res.json()
      for (const z of zones) {
        const cfg = LAYER_CONFIG[z.layer]
        if (!cfg) continue
        const geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.alpha, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(z.x, RECT_Y, z.z)
        mesh.scale.set(z.width, 1, z.depth)
        this._layerGroups[z.layer]?.add(mesh)
      }
    } catch (e) {
      console.warn('[ZoneEditor] Failed to load zones.json:', e)
    }
  }

  async _save(btn) {
    const zones = []
    for (const [layerName, group] of Object.entries(this._layerGroups)) {
      const cfg = LAYER_CONFIG[layerName]
      for (const mesh of group.children) {
        if (!mesh.isMesh) continue
        zones.push({
          layer: layerName,
          x: mesh.position.x,
          z: mesh.position.z,
          width: mesh.scale.x,
          depth: mesh.scale.z,
          flag: cfg.flag
        })
      }
    }
    try {
      const res = await fetch('/dev/save-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zones)
      })
      if (res.ok) { btn.style.color = '#0f0'; setTimeout(() => { btn.style.color = '' }, 1000) }
      else throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.error('[ZoneEditor] Save failed:', e)
      btn.style.color = '#f00'; setTimeout(() => { btn.style.color = '' }, 1000)
    }
  }

  // Called by GSM render loop when active
  getActiveCamera() {
    return this._active ? this._orthoCamera : null
  }
}
```

**Step 3: Commit**
```bash
git add src/systems/ZoneSystem.js src/systems/ZoneEditor.js
git commit -m "feat: ZoneSystem + ZoneEditor — dark zone queries, dev editor tool"
```

---

### Task 7: SanitySystem

**Files:**
- Create: `src/systems/SanitySystem.js`

**Step 1: Implement SanitySystem**
```js
// src/systems/SanitySystem.js

// Tunable constants
const NIKO_HUG_RATE    = +0.15   // per second
const NIKO_HELD_RATE   = +0.02   // per second
const NIKO_AWAY_RATE   = -0.05   // per second
const SHADOW_RATE      = -0.10   // per second
const LIGHT_RATE       =  0.00   // per second
const PROX_MAX_RATE    = -0.15   // per second (at factor=1)
const DEPLETION_HOLD_MS = 2500

function nikoRateFn(constants) {
  return (nikoState) => {
    if (nikoState === 'hugging') return constants.hug
    if (nikoState === 'held') return constants.held
    return constants.away
  }
}

function darkRateFn(constants) {
  return (isDark) => isDark ? constants.shadow : constants.light
}

function proxRateFn(_constants) {
  // Stub until EnemySystem is built
  return (_factor) => 0
}

export class SanitySystem {
  constructor(gsm) {
    this._gsm = gsm

    this._sanity = 1.0
    this._nikoState = 'held'
    this._isDark = false
    this._enemyProximityFactor = 0

    this._nikoRate = nikoRateFn({ hug: NIKO_HUG_RATE, held: NIKO_HELD_RATE, away: NIKO_AWAY_RATE })
    this._darkRate = darkRateFn({ shadow: SHADOW_RATE, light: LIGHT_RATE })
    this._proxRate = proxRateFn({ maxRate: PROX_MAX_RATE })

    this._depletionTimer = 0
    this._depleted = false
  }

  onNikoStateChange(state) { this._nikoState = state }
  onDarknessChange(isDark) { this._isDark = isDark }
  onEnemyProximityChange(factor) { this._enemyProximityFactor = factor }

  getSanity() { return this._sanity }

  update(delta) {
    if (!this._gsm.isActive) return
    if (this._depleted) return

    const dt = delta // seconds
    const d = (
      this._nikoRate(this._nikoState) +
      this._darkRate(this._isDark) +
      this._proxRate(this._enemyProximityFactor)
    )

    this._sanity = Math.max(0, Math.min(1, this._sanity + d * dt))

    if (this._sanity <= 0) {
      this._depletionTimer += dt * 1000 // convert to ms
      if (this._depletionTimer >= DEPLETION_HOLD_MS) {
        this._depleted = true
        this._gsm.onSanityDepleted()
      }
    } else {
      this._depletionTimer = 0
    }
  }
}
```

**Step 2: Commit**
```bash
git add src/systems/SanitySystem.js
git commit -m "feat: SanitySystem — curried rate functions, depletion hold, GSM hookup"
```

---

### Task 8: AudioManager

**Files:**
- Create: `src/systems/AudioManager.js`

**Step 1: Implement AudioManager**
```js
// src/systems/AudioManager.js

// Tunable constants — all values in one place
const AUDIO_CONFIG = {
  crossfadeDuration: {
    menuToIntro:    1.5,
    introToDesert:  2.0,
    desertToTemple: 3.0,
    templeToEnd:    2.0,
    settingsResume: 0.8,
  },
  sceneVolume: {
    menu:   0.6,
    intro:  0.5,
    desert: 0.55,
    temple: 0.5,
    end:    0.4,
  },
  actionVolume: {
    footstep:    0.4,
    nikoPickup:  0.5,
    nikoPutdown: 0.5,
    nikoHug:     0.6,
    uiButton:    0.3,
  },
  sanityDistortion: {
    minIntensity:   0.0,   // at sanity=1
    maxIntensity:   0.8,   // at sanity=0
    filterType:     'lowpass',
    pitchShiftRange: 0.15,
  }
}

const SCENE_AUDIO_MAP = {
  MENU:   'menu-ambient.mp3',
  INTRO:  'intro-audio.mp3',
  DESERT: 'desert-ambient.mp3',
  TEMPLE: 'temple-ambient.mp3',
  END:    'end-audio.mp3',
}

export class AudioManager {
  constructor(gsm) {
    this._gsm = gsm
    this._ctx = null
    this._unlocked = false

    this._sceneSource = null
    this._sceneGain = null
    this._transitionSource = null
    this._transitionGain = null
    this._actionGain = null
    this._distortionFilter = null
    this._distortionGain = null

    this._currentState = null
    this._prevState = null
    this._buffers = {}
    this._footstepToggle = 0
    this._footstepTimer = 0
    const FOOTSTEP_INTERVAL = 0.5 // seconds between footstep sounds

    this._sanity = 1.0

    // Click-to-start gate: browser autoplay policy
    document.addEventListener('click', () => this._unlock(), { once: true })
  }

  async preload() {
    // All audio files must be in /public/audio/
    const files = [
      'menu-ambient.mp3', 'intro-audio.mp3', 'desert-ambient.mp3',
      'temple-ambient.mp3', 'end-audio.mp3',
      'footstep-a.mp3', 'footstep-b.mp3',
      'niko-pickup.mp3', 'niko-putdown.mp3', 'niko-hug.mp3', 'ui-button.mp3'
    ]
    // Preload is deferred until AudioContext is unlocked — just store paths for now
    this._filePaths = Object.fromEntries(files.map(f => [f, `/audio/${f}`]))
  }

  async _unlock() {
    if (this._unlocked) return
    this._ctx = new (window.AudioContext || window.webkitAudioContext)()
    this._unlocked = true

    // Build audio graph
    this._masterGain = this._ctx.createGain()
    this._masterGain.gain.value = 1
    this._masterGain.connect(this._ctx.destination)

    this._sceneGain = this._ctx.createGain()
    this._sceneGain.gain.value = 0
    this._sceneGain.connect(this._masterGain)

    this._transitionGain = this._ctx.createGain()
    this._transitionGain.gain.value = 0
    this._transitionGain.connect(this._masterGain)

    this._actionGain = this._ctx.createGain()
    this._actionGain.gain.value = 1
    this._actionGain.connect(this._masterGain)

    // Distortion filter (temple only)
    this._distortionFilter = this._ctx.createBiquadFilter()
    this._distortionFilter.type = AUDIO_CONFIG.sanityDistortion.filterType
    this._distortionFilter.frequency.value = 20000 // start fully open
    this._distortionFilter.connect(this._masterGain)

    // Now load all buffers
    await this._loadAllBuffers()

    // Start the current state's audio if already in one
    if (this._currentState) this._playScene(this._currentState)
  }

  async _loadAllBuffers() {
    const promises = []
    for (const [name, path] of Object.entries(this._filePaths)) {
      promises.push(
        fetch(path)
          .then(r => r.arrayBuffer())
          .then(ab => this._ctx.decodeAudioData(ab))
          .then(buf => { this._buffers[name] = buf })
          .catch(e => console.warn(`[AudioManager] Failed to load ${name}:`, e))
      )
    }
    await Promise.all(promises)
  }

  onStateChange(stateName) {
    this._prevState = this._currentState
    this._currentState = stateName

    if (!this._unlocked || !this._ctx) return

    if (stateName === 'SETTINGS') {
      this._hardStop()
      return
    }

    if (this._prevState === 'SETTINGS') {
      this._fadeIn(this._sceneGain, AUDIO_CONFIG.sceneVolume[stateName.toLowerCase()] || 0.5, AUDIO_CONFIG.crossfadeDuration.settingsResume)
      return
    }

    this._crossfadeTo(stateName)
  }

  _crossfadeTo(stateName) {
    const filename = SCENE_AUDIO_MAP[stateName]
    if (!filename || !this._buffers[filename]) return

    const targetVol = AUDIO_CONFIG.sceneVolume[stateName.toLowerCase()] || 0.5
    const duration = this._getCrossfadeDuration(this._prevState, stateName)

    // Fade out old scene
    this._sceneGain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + duration)

    // Fade in new scene via transition channel
    const src = this._ctx.createBufferSource()
    src.buffer = this._buffers[filename]
    src.loop = true
    src.connect(this._transitionGain)
    src.start()
    this._transitionGain.gain.setValueAtTime(0, this._ctx.currentTime)
    this._transitionGain.gain.linearRampToValueAtTime(targetVol, this._ctx.currentTime + duration)

    // After crossfade, swap to scene channel
    setTimeout(() => {
      if (this._sceneSource) this._sceneSource.stop()
      this._sceneSource = src
      src.disconnect(this._transitionGain)
      src.connect(this._sceneGain)
      this._sceneGain.gain.setValueAtTime(targetVol, this._ctx.currentTime)
      this._transitionGain.gain.setValueAtTime(0, this._ctx.currentTime)
    }, duration * 1000)
  }

  _playScene(stateName) {
    const filename = SCENE_AUDIO_MAP[stateName]
    if (!filename || !this._buffers[filename]) return
    const vol = AUDIO_CONFIG.sceneVolume[stateName.toLowerCase()] || 0.5
    if (this._sceneSource) { try { this._sceneSource.stop() } catch (_) {} }
    const src = this._ctx.createBufferSource()
    src.buffer = this._buffers[filename]
    src.loop = true
    src.connect(this._sceneGain)
    src.start()
    this._sceneGain.gain.setValueAtTime(vol, this._ctx.currentTime)
    this._sceneSource = src
  }

  _hardStop() {
    if (this._sceneGain) this._sceneGain.gain.setValueAtTime(0, this._ctx.currentTime)
    if (this._transitionGain) this._transitionGain.gain.setValueAtTime(0, this._ctx.currentTime)
  }

  _fadeIn(gainNode, targetVol, duration) {
    gainNode.gain.linearRampToValueAtTime(targetVol, this._ctx.currentTime + duration)
  }

  _getCrossfadeDuration(from, to) {
    const key = `${(from||'').toLowerCase()}To${to.charAt(0).toUpperCase()}${to.slice(1).toLowerCase()}`
    return AUDIO_CONFIG.crossfadeDuration[key] ?? 1.5
  }

  // Action sounds
  playFootstep() {
    if (!this._unlocked) return
    const name = this._footstepToggle % 2 === 0 ? 'footstep-a.mp3' : 'footstep-b.mp3'
    this._footstepToggle++
    this._playAction(name, AUDIO_CONFIG.actionVolume.footstep)
  }

  playNikoPickup()  { this._playAction('niko-pickup.mp3',  AUDIO_CONFIG.actionVolume.nikoPickup) }
  playNikoPutdown() { this._playAction('niko-putdown.mp3', AUDIO_CONFIG.actionVolume.nikoPutdown) }
  playNikoHug()     { this._playAction('niko-hug.mp3',     AUDIO_CONFIG.actionVolume.nikoHug) }
  playUIButton()    { this._playAction('ui-button.mp3',    AUDIO_CONFIG.actionVolume.uiButton) }

  _playAction(filename, vol) {
    if (!this._buffers[filename] || !this._ctx) return
    const src = this._ctx.createBufferSource()
    src.buffer = this._buffers[filename]
    const gainNode = this._ctx.createGain()
    gainNode.gain.value = vol
    src.connect(gainNode)
    gainNode.connect(this._actionGain)
    src.start()
  }

  onSanityChange(sanity) {
    this._sanity = sanity
    if (this._currentState !== 'TEMPLE' || !this._ctx) return
    const t = 1 - sanity // 0 at high sanity, 1 at low sanity
    const cfg = AUDIO_CONFIG.sanityDistortion
    const intensity = cfg.minIntensity + t * (cfg.maxIntensity - cfg.minIntensity)
    // Lowpass filter frequency: 20kHz (open) → 500Hz (distorted)
    const freq = 20000 - intensity * 19500
    this._distortionFilter.frequency.linearRampToValueAtTime(freq, this._ctx.currentTime + 0.1)
  }

  update(delta) {
    // Footstep driven by movement state — caller calls playFootstep() on walking state
    // Sanity distortion checked each frame if in TEMPLE
    if (this._currentState === 'TEMPLE' && this._unlocked) {
      this.onSanityChange(this._sanity)
    }
  }
}
```

**Step 2: Commit**
```bash
git add src/systems/AudioManager.js
git commit -m "feat: AudioManager — 3-layer audio, crossfades, sanity distortion, action sounds"
```

---

### Task 9: LightingSystem

**Files:**
- Create: `src/systems/LightingSystem.js`

**Step 1: Implement LightingSystem**
```js
// src/systems/LightingSystem.js
import * as THREE from 'three'

// Tunable constants
const NIKO_INTENSITY_MAX    = 2.0
const NIKO_INTENSITY_MIN    = 0.3
const NIKO_RADIUS_MAX       = 8.0
const NIKO_RADIUS_MIN       = 2.0
const AMBIENT_DESERT        = 0.6
const AMBIENT_TEMPLE        = 0.05
const TORCH_INTENSITY       = 3.0
const TORCH_COLOR           = 0xff8800
const TORCH_RADIUS          = 4.0
const ARTIFACT_INTENSITY    = 0.8
const ARTIFACT_COLOR        = 0x88aaff
const ARTIFACT_RADIUS       = 3.0
const ZONE_LIGHT_INTENSITY  = 1.2
const ZONE_LIGHT_RADIUS_SCALE = 0.8
const MAX_POINT_LIGHTS      = 64
const NIKO_LERP_RATE        = 3.0
const NIKO_Y_OFFSET         = 0.3

export class LightingSystem {
  constructor(scene) {
    this._scene = scene
    this._camera = null
    this._nikoLight = null
    this._ambientLight = null
    this._pointLights = []
    this._ready = false
    this._gsm = null
  }

  setGSM(gsm) { this._gsm = gsm }

  setCamera(cam) {
    this._camera = cam
    if (this._nikoLight && this._camera) {
      this._camera.add(this._nikoLight)
    }
  }

  releaseCamera() {
    if (this._nikoLight && this._camera) {
      this._camera.remove(this._nikoLight)
    }
    this._camera = null
  }

  init(zones) {
    // Ambient light
    this._ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_DESERT)
    this._scene.add(this._ambientLight)

    // Niko light
    this._nikoLight = new THREE.PointLight(0xffeedd, NIKO_INTENSITY_MAX, NIKO_RADIUS_MAX)
    this._nikoLight.position.set(0, NIKO_Y_OFFSET, 0)
    // Will be added to camera on setCamera()

    // Static lights from zone data
    let lightCount = 0
    for (const zone of (zones || [])) {
      if (lightCount >= MAX_POINT_LIGHTS) {
        console.warn(`[LightingSystem] MAX_POINT_LIGHTS (${MAX_POINT_LIGHTS}) exceeded`)
        break
      }
      const light = this._createZoneLight(zone)
      if (light) {
        this._scene.add(light)
        this._pointLights.push(light)
        lightCount++
      }
    }

    this._ready = true
  }

  _createZoneLight(zone) {
    switch (zone.layer) {
      case 'torch_zones': {
        const l = new THREE.PointLight(TORCH_COLOR, TORCH_INTENSITY, TORCH_RADIUS)
        l.position.set(zone.x, 2.0, zone.z)
        return l
      }
      case 'artifact_zones': {
        const l = new THREE.PointLight(ARTIFACT_COLOR, ARTIFACT_INTENSITY, ARTIFACT_RADIUS)
        l.position.set(zone.x, 1.0, zone.z)
        return l
      }
      case 'light_zones': {
        const radius = Math.max(zone.width, zone.depth) * ZONE_LIGHT_RADIUS_SCALE
        const l = new THREE.PointLight(0xffffff, ZONE_LIGHT_INTENSITY, radius)
        l.position.set(zone.x, 2.5, zone.z)
        return l
      }
      default:
        return null
    }
  }

  onSceneZoneChange(zone) {
    if (!this._ambientLight) return
    this._ambientLight.intensity = zone === 'temple' ? AMBIENT_TEMPLE : AMBIENT_DESERT
  }

  update(delta, sanityFloat) {
    if (!this._gsm?.isActive || !this._nikoLight) return

    const targetIntensity = NIKO_INTENSITY_MIN + sanityFloat * (NIKO_INTENSITY_MAX - NIKO_INTENSITY_MIN)
    const targetRadius    = NIKO_RADIUS_MIN    + sanityFloat * (NIKO_RADIUS_MAX    - NIKO_RADIUS_MIN)

    this._nikoLight.intensity += (targetIntensity - this._nikoLight.intensity) * NIKO_LERP_RATE * delta
    this._nikoLight.distance  += (targetRadius    - this._nikoLight.distance)  * NIKO_LERP_RATE * delta
  }
}
```

**Step 2: Commit**
```bash
git add src/systems/LightingSystem.js
git commit -m "feat: LightingSystem — Niko light, zone lights, ambient, sanity-driven lerp"
```

---

### Task 10: EnemySystem

**Files:**
- Create: `src/systems/EnemySystem.js`

**Step 1: Implement EnemySystem**
```js
// src/systems/EnemySystem.js
import * as THREE from 'three'
import { SnakeCollision } from './SnakeCollision.js'
import { LineOfSight } from './LineOfSight.js'

// Tunable constants
const WANDER_SPEED         = 1.5
const HUNT_SPEED           = 4.0
const SEARCH_SPEED         = 2.5
const IDLE_DURATION_MIN    = 2.0   // seconds
const IDLE_DURATION_MAX    = 5.0
const SEARCH_DURATION      = 8.0   // seconds
const DETECTION_MAX_RANGE  = 12.0
const CATCH_DISTANCE       = 1.2
const LOS_CHECK_INTERVAL   = 4     // frames
const SPLINE_POINTS        = 6
const WANDER_RADIUS        = 20.0
const PARTICLE_COUNT       = 15
const PARTICLE_DRIFT_SPEED = 0.3
const PARTICLE_SIZE        = 0.15
const ENEMY_LIGHT_INTENSITY = 0.5
const ENEMY_LIGHT_RADIUS    = 3.0

export class EnemySystem {
  constructor(scene, sceneManagement, gsm) {
    this._scene = scene
    this._sm = sceneManagement
    this._gsm = gsm

    this._state = 'inactive'
    this._position = new THREE.Vector3(60, 1, 10) // start position in temple
    this._forward = new THREE.Vector3(1, 0, 0)
    this._lastKnownLitPosition = null
    this._idleTimer = 0
    this._searchTimer = 0
    this._losFrame = 0
    this._losResult = false
    this._wanderTarget = new THREE.Vector3()

    this._playerPosition = new THREE.Vector3()
    this._playerLightLevel = 1.0

    // Spline skeleton — N points following the head's path
    this._splineHistory = Array.from({ length: 30 }, () => this._position.clone())
    this._splinePoints = []

    // Callbacks
    this.onPlayerCaught = null
    this.onEnemyProximityChange = null  // (factor: 0-1) => void

    this._collision = null
    this._los = null
    this._proximityFactor = 0

    this._buildVisuals()
  }

  init() {
    const templeMesh = this._sm.getTempleMesh?.()
    const desertMesh = this._sm.getDesertMesh?.()
    this._collision = new SnakeCollision(templeMesh, desertMesh)
    this._los = new LineOfSight(templeMesh)
  }

  onArtifactPickedUp() {
    if (this._state === 'inactive') {
      this._state = 'wandering'
      this._pickWanderTarget()
      console.log('[EnemySystem] activated — artifact picked up')
    }
  }

  _buildVisuals() {
    // Snake body: sparse soft points
    this._particleGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    this._particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const particleMat = new THREE.PointsMaterial({
      color: 0x221100,
      size: PARTICLE_SIZE,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    this._particles = new THREE.Points(this._particleGeo, particleMat)
    this._particles.visible = false
    this._scene.add(this._particles)

    // Shedding particles (ambient drift toward player)
    this._sheddingGeo = new THREE.BufferGeometry()
    const shedPos = new Float32Array(PARTICLE_COUNT * 3)
    this._sheddingGeo.setAttribute('position', new THREE.BufferAttribute(shedPos, 3))
    const shedMat = new THREE.PointsMaterial({
      color: 0x334455,
      size: 0.05,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this._shedding = new THREE.Points(this._sheddingGeo, shedMat)
    this._shedding.visible = false
    this._scene.add(this._shedding)

    // Enemy point light
    this._enemyLight = new THREE.PointLight(0x221100, ENEMY_LIGHT_INTENSITY, ENEMY_LIGHT_RADIUS)
    this._scene.add(this._enemyLight)
  }

  update(delta) {
    if (!this._gsm.isActive || this._state === 'inactive') return

    this._losFrame++
    if (this._losFrame >= LOS_CHECK_INTERVAL) {
      this._losFrame = 0
      this._losResult = this._los?.check(this._position, this._playerPosition) ?? false
    }

    this._updateState(delta)
    this._moveTowardTarget(delta)
    this._updateProximity()
    this._updateVisuals(delta)
  }

  _updateState(delta) {
    const distToPlayer = this._position.distanceTo(this._playerPosition)
    const detectionRadius = DETECTION_MAX_RANGE * this._playerLightLevel

    switch (this._state) {
      case 'wandering':
        if (distToPlayer < detectionRadius && this._losResult) {
          this._state = 'hunt'
          break
        }
        if (this._position.distanceTo(this._wanderTarget) < 1.0) {
          this._state = 'idle'
          this._idleTimer = IDLE_DURATION_MIN + Math.random() * (IDLE_DURATION_MAX - IDLE_DURATION_MIN)
        }
        break

      case 'idle':
        this._idleTimer -= delta
        if (distToPlayer < detectionRadius && this._losResult) {
          this._state = 'hunt'
          break
        }
        if (this._idleTimer <= 0) {
          this._state = 'wandering'
          this._pickWanderTarget()
        }
        break

      case 'hunt':
        if (distToPlayer <= CATCH_DISTANCE) {
          this._state = 'inactive'
          this.onPlayerCaught?.()
          this._gsm.onPlayerCaught()
          break
        }
        // Update last known LIT position
        if (this._playerLightLevel > 0) {
          this._lastKnownLitPosition = this._playerPosition.clone()
        }
        // Player moves into darkness → lose them
        if (!this._losResult && this._playerLightLevel === 0) {
          this._state = 'searching'
          this._searchTimer = SEARCH_DURATION
        }
        break

      case 'searching':
        this._searchTimer -= delta
        if (distToPlayer < detectionRadius && this._losResult) {
          this._state = 'hunt'
          break
        }
        if (this._searchTimer <= 0) {
          this._state = 'wandering'
          this._pickWanderTarget()
        }
        break
    }
  }

  _moveTowardTarget(delta) {
    let target = null
    let speed = WANDER_SPEED

    switch (this._state) {
      case 'wandering': target = this._wanderTarget; speed = WANDER_SPEED; break
      case 'hunt': target = this._playerPosition; speed = HUNT_SPEED; break
      case 'searching': target = this._lastKnownLitPosition; speed = SEARCH_SPEED; break
      case 'idle': return
    }

    if (!target) return

    const dir = new THREE.Vector3().subVectors(target, this._position)
    if (dir.lengthSq() < 0.01) return
    dir.normalize()
    this._forward.copy(dir)

    this._position.addScaledVector(dir, speed * delta)

    // Record path history for spline/tail
    this._splineHistory.unshift(this._position.clone())
    if (this._splineHistory.length > 30) this._splineHistory.pop()

    // Update surface collision
    this._collision?.update(this._position, this._forward)
  }

  _pickWanderTarget() {
    // Random point near temple center
    this._wanderTarget.set(
      50 + (Math.random() - 0.5) * WANDER_RADIUS,
      1,
      (Math.random() - 0.5) * WANDER_RADIUS
    )
  }

  _updateProximity() {
    const dist = this._position.distanceTo(this._playerPosition)
    this._proximityFactor = Math.max(0, 1 - dist / DETECTION_MAX_RANGE)
    this.onEnemyProximityChange?.(this._proximityFactor)
  }

  _updateVisuals(delta) {
    const isVisible = this._state !== 'inactive'
    this._particles.visible = isVisible
    this._shedding.visible = isVisible
    this._enemyLight.visible = isVisible

    if (!isVisible) return

    // Update snake body points along history
    const posArr = this._particleGeo.attributes.position.array
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const histIdx = Math.floor(i * (this._splineHistory.length / PARTICLE_COUNT))
      const hPos = this._splineHistory[Math.min(histIdx, this._splineHistory.length - 1)]
      posArr[i * 3]     = hPos.x + (Math.random() - 0.5) * 0.5
      posArr[i * 3 + 1] = hPos.y + (Math.random() - 0.5) * 0.3
      posArr[i * 3 + 2] = hPos.z + (Math.random() - 0.5) * 0.5
    }
    this._particleGeo.attributes.position.needsUpdate = true

    // Shedding particles drift toward player
    const shedArr = this._sheddingGeo.attributes.position.array
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = (Date.now() * 0.001 + i * 0.3) % 1
      const lerped = new THREE.Vector3().lerpVectors(this._position, this._playerPosition, t)
      shedArr[i * 3]     = lerped.x + (Math.random() - 0.5) * 0.5
      shedArr[i * 3 + 1] = lerped.y + 0.5 + Math.sin(t * Math.PI) * 0.5
      shedArr[i * 3 + 2] = lerped.z + (Math.random() - 0.5) * 0.5
    }
    this._sheddingGeo.attributes.position.needsUpdate = true

    this._enemyLight.position.copy(this._position)
  }

  setPlayerPosition(pos) { this._playerPosition.copy(pos) }
  setPlayerLightLevel(level) { this._playerLightLevel = level }
  get position() { return this._position }
}
```

**Step 2: Commit**
```bash
git add src/systems/EnemySystem.js
git commit -m "feat: EnemySystem — state machine, snake visuals, particle body, proximity"
```

---

### Task 11: PostProcessing

**Files:**
- Create: `src/systems/PostProcessing.js`

**Step 1: Implement PostProcessing**
```js
// src/systems/PostProcessing.js
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

// Tunable constants
const HUG_LOOKAT_DURATION = 0.4   // seconds
const HUG_FADEOUT_DURATION = 0.8
const HUG_HOLD_DURATION = 0.3
const HUG_BLINK_COUNT = 3
const HUG_BLINK_DURATION = 0.15
const HUG_SHAKE_MAGNITUDE = 0.015
const HUG_SHAKE_DURATION = 0.4
const LOOKAT_THRESHOLD = 0.02
const TIME_WRAP = 1000.0
const MAX_SHAKE_MAGNITUDE = 0.03

const SanityShader = {
  uniforms: {
    tDiffuse:    { value: null },
    sanityFloat: { value: 0.0 },
    blackOverlay:{ value: 0.0 },
    time:        { value: 0.0 },
    shakeOffset: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float sanityFloat;
    uniform float blackOverlay;
    uniform float time;
    uniform vec2 shakeOffset;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      float inv = 1.0 - sanityFloat;  // 0 = sane, 1 = insane

      // UV warp / screen sway
      vec2 uv = vUv;
      uv += shakeOffset;
      uv.x += sin(uv.y * 8.0 + time * 0.7) * inv * 0.015;
      uv.y += cos(uv.x * 6.0 + time * 0.5) * inv * 0.010;
      uv += (uv - 0.5) * sin(time * 0.3) * inv * 0.005; // sway

      // Chromatic aberration
      float aberr = inv * 0.012;
      vec4 col;
      col.r = texture2D(tDiffuse, uv + vec2(aberr, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(aberr, 0.0)).b;
      col.a = 1.0;

      // Vignette
      vec2 vigUv = uv - 0.5;
      float vig = 1.0 - dot(vigUv, vigUv) * 2.5 * inv;
      col.rgb *= clamp(vig, 0.0, 1.0);

      // Desaturation
      float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(lum), inv * 0.6);

      // Film grain
      float grain = (rand(uv + time * 0.01) - 0.5) * inv * 0.08;
      col.rgb += grain;

      // Black overlay (hug sequence)
      col.rgb = mix(col.rgb, vec3(0.0), blackOverlay);

      gl_FragColor = col;
    }
  `
}

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this._renderer = renderer
    this._scene = scene
    this._camera = camera
    this._gsm = null
    this._playerController = null

    this._composer = new EffectComposer(renderer)
    this._renderPass = new RenderPass(scene, camera)
    this._composer.addPass(this._renderPass)

    this._shaderPass = new ShaderPass(SanityShader)
    this._shaderPass.renderToScreen = true
    this._composer.addPass(this._shaderPass)

    this._time = 0
    this._hugState = 'idle'
    this._hugTimer = 0
    this._blinkCount = 0
    this._nikoPosition = new THREE.Vector3()
    this._origQuat = new THREE.Quaternion()
    this._targetQuat = new THREE.Quaternion()
  }

  setGSM(gsm) { this._gsm = gsm }
  setPlayerController(pc) { this._playerController = pc }

  setCamera(cam) {
    this._camera = cam
    this._renderPass.camera = cam
  }

  onNikoStateChange(state, nikoPosition) {
    if (state === 'hugging' && this._hugState === 'idle') {
      this._nikoPosition.copy(nikoPosition || new THREE.Vector3())
      this._hugState = 'lookAt'
      this._hugTimer = 0
      this._origQuat.copy(this._camera.quaternion)
      this._targetQuat.copy(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(this._camera.position, this._nikoPosition, new THREE.Vector3(0, 1, 0))
        )
      )
      if (this._playerController) this._playerController.freezeCamera(true)
    }

    if (state === 'held' && this._hugState !== 'idle') {
      this._endHugSequence()
    }
  }

  _endHugSequence() {
    this._hugState = 'idle'
    this._hugTimer = 0
    this._shaderPass.uniforms.blackOverlay.value = 0
    this._shaderPass.uniforms.shakeOffset.value.set(0, 0)
    if (this._playerController) this._playerController.freezeCamera(false)
  }

  _updateHugSequence(delta) {
    this._hugTimer += delta

    switch (this._hugState) {
      case 'lookAt': {
        const t = Math.min(this._hugTimer / HUG_LOOKAT_DURATION, 1)
        this._camera.quaternion.slerpQuaternions(this._origQuat, this._targetQuat, t)
        if (t >= 1) { this._hugState = 'fadeOut'; this._hugTimer = 0 }
        break
      }
      case 'fadeOut': {
        const t = Math.min(this._hugTimer / HUG_FADEOUT_DURATION, 1)
        this._shaderPass.uniforms.blackOverlay.value = t
        if (t >= 1) { this._hugState = 'holdBlack'; this._hugTimer = 0 }
        break
      }
      case 'holdBlack': {
        if (this._hugTimer >= HUG_HOLD_DURATION) {
          this._hugState = 'blink'
          this._hugTimer = 0
          this._blinkCount = 0
        }
        break
      }
      case 'blink': {
        const blinkPhase = (this._hugTimer % (HUG_BLINK_DURATION * 2))
        this._shaderPass.uniforms.blackOverlay.value = blinkPhase < HUG_BLINK_DURATION ? 0 : 1
        if (this._hugTimer >= HUG_BLINK_DURATION * 2 * HUG_BLINK_COUNT) {
          this._hugState = 'shake'
          this._hugTimer = 0
          this._shaderPass.uniforms.blackOverlay.value = 0
        }
        break
      }
      case 'shake': {
        const mag = Math.min(HUG_SHAKE_MAGNITUDE, MAX_SHAKE_MAGNITUDE)
        this._shaderPass.uniforms.shakeOffset.value.set(
          (Math.random() - 0.5) * mag,
          (Math.random() - 0.5) * mag
        )
        if (this._hugTimer >= HUG_SHAKE_DURATION) {
          this._hugState = 'done'
        }
        break
      }
      case 'done': {
        this._endHugSequence()
        break
      }
    }
  }

  update(delta, sanityFloat) {
    if (!this._gsm?.isActive) return

    this._time = (this._time + delta) % TIME_WRAP
    this._shaderPass.uniforms.time.value = this._time
    this._shaderPass.uniforms.sanityFloat.value = 1.0 - sanityFloat // invert: high sanity = low effect

    if (this._hugState !== 'idle') {
      this._updateHugSequence(delta)
    }
  }

  render() {
    this._composer.render()
  }
}
```

**Step 2: Commit**
```bash
git add src/systems/PostProcessing.js
git commit -m "feat: PostProcessing — EffectComposer, custom GLSL shader, hug sequence state machine"
```

---

### Task 12: Wire Everything Together (main.js + flow states)

**Files:**
- Modify: `src/main.js`
- Modify: `src/GameStateMachine/index.js`
- Modify: `src/GameStateMachine/flow/DesertState.js`
- Modify: `src/GameStateMachine/flow/TempleState.js`
- Modify: `src/GameStateMachine/flow/IntroState.js`

**Step 1: Full main.js wiring**

Connect all systems, set up event wiring between systems, register TriggerSystem exit zone.

**Step 2: Integrate PostProcessing into GSM render loop**

Replace `renderer.render(scene, camera)` with `postProcessing.render()` when active.

**Step 3: Commit**
```bash
git add src/main.js src/GameStateMachine/
git commit -m "feat: full system wiring — all systems connected, events wired, game playable"
```

---

### Task 13: Final Verification

**Step 1: Run dev server**
Run: `npm run dev`
Expected: No console errors on startup, "PRESS TO START" visible, clicking transitions to game.

**Step 2: Verify GameStateMachine loop**
Expected: Render loop running, no "Cannot read property" errors.

**Step 3: Final commit**
```bash
git add .
git commit -m "chore: final wiring and initial zones.json"
```

---
