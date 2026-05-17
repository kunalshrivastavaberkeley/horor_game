// src/systems/EnemySystem.js
// Snake enemy — state machine, spline-based particle body, shedding particles.
// Inactive until artifact is picked up.

import * as THREE from 'three'
import { SnakeCollision } from './SnakeCollision.js'
import { LineOfSight } from './LineOfSight.js'

// Tunable constants
const WANDER_SPEED           = 1.5   // units/second
const HUNT_SPEED             = 4.0
const SEARCH_SPEED           = 2.5
const IDLE_DURATION_MIN      = 2.0   // seconds
const IDLE_DURATION_MAX      = 5.0
const SEARCH_DURATION        = 8.0
const DETECTION_MAX_RANGE    = 12.0  // units — at full player light level
const CATCH_DISTANCE         = 1.2   // player caught if snake within this distance
const LOS_CHECK_INTERVAL     = 4     // frames between LineOfSight raycasts
const WANDER_RADIUS          = 20.0  // radius of random wander targets around temple
const WANDER_CENTER          = new THREE.Vector3(50, 0, 0)  // temple center

const BODY_PARTICLE_COUNT    = 15    // sparse soft points for snake body
const BODY_PARTICLE_SCATTER  = 0.4   // random scatter around spline point
const BODY_PARTICLE_SIZE     = 0.15
const BODY_PARTICLE_OPACITY  = 0.2
const SPLINE_HISTORY_LENGTH  = 30    // recorded head positions for tail drag

const SHED_PARTICLE_COUNT    = 12    // ambient particles drifting toward player
const SHED_PARTICLE_SIZE     = 0.06
const SHED_PARTICLE_OPACITY  = 0.15

const ENEMY_LIGHT_INTENSITY  = 0.5
const ENEMY_LIGHT_RADIUS     = 3.0
const ENEMY_LIGHT_COLOR      = 0x221100

export class EnemySystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./SceneManagement.js').SceneManagement} sceneManagement
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(scene, sceneManagement, gsm) {
    this._scene = scene
    this._sm = sceneManagement
    this._gsm = gsm

    // State
    this._state = 'inactive'   // inactive | wandering | idle | hunt | searching
    this._position = new THREE.Vector3(60, 1, 8)   // start position in temple
    this._forward = new THREE.Vector3(1, 0, 0)
    this._lastKnownLitPosition = null   // last position where player was lit
    this._idleTimer = 0
    this._searchTimer = 0
    this._wanderTarget = new THREE.Vector3()
    this._losFrame = 0         // frame counter for LOS throttle
    this._losResult = false    // last LOS check result

    // External state (updated by events from other systems)
    this._playerPosition = new THREE.Vector3()
    this._playerLightLevel = 1.0   // 0 = dark, 1 = lit

    // Callbacks — assigned by main.js
    this.onEnemyProximityChange = null  // (factor: number) => void

    // History buffer for tail drag
    this._splineHistory = Array.from({ length: SPLINE_HISTORY_LENGTH }, () => this._position.clone())

    // Sub-systems (initialized in init())
    this._collision = null
    this._los = null

    this._buildVisuals()
  }

  /**
   * Call after SceneManagement is ready to initialize collision sub-systems.
   */
  init() {
    const templeMesh = this._sm.getTempleMesh?.()
    const desertMesh = this._sm.getDesertMesh?.()
    this._collision = new SnakeCollision(templeMesh, desertMesh)
    this._los = new LineOfSight(templeMesh, desertMesh)
  }

  // ─── External events ─────────────────────────────────────────────────────────

  onArtifactPickedUp() {
    if (this._state === 'inactive') {
      this._state = 'wandering'
      this._pickWanderTarget()
      this._showBody(true)
      console.log('[EnemySystem] Snake activated')
    }
  }

  setPlayerPosition(pos) {
    this._playerPosition.copy(pos)
  }

  setPlayerLightLevel(level) {
    this._playerLightLevel = level
  }

  // ─── Build Three.js visuals ──────────────────────────────────────────────────

  _buildVisuals() {
    // Snake body — sparse particle cloud along spline history
    this._bodyGeo = new THREE.BufferGeometry()
    const bodyPos = new Float32Array(BODY_PARTICLE_COUNT * 3)
    this._bodyGeo.setAttribute('position', new THREE.BufferAttribute(bodyPos, 3))

    const bodyMat = new THREE.PointsMaterial({
      color: 0x221100,
      size: BODY_PARTICLE_SIZE,
      transparent: true,
      opacity: BODY_PARTICLE_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    this._bodyPoints = new THREE.Points(this._bodyGeo, bodyMat)
    this._bodyPoints.visible = false
    this._scene.add(this._bodyPoints)

    // Shedding particles — drift slowly toward player (invasion of space)
    this._shedGeo = new THREE.BufferGeometry()
    const shedPos = new Float32Array(SHED_PARTICLE_COUNT * 3)
    this._shedGeo.setAttribute('position', new THREE.BufferAttribute(shedPos, 3))

    const shedMat = new THREE.PointsMaterial({
      color: 0x334455,
      size: SHED_PARTICLE_SIZE,
      transparent: true,
      opacity: SHED_PARTICLE_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this._shedPoints = new THREE.Points(this._shedGeo, shedMat)
    this._shedPoints.visible = false
    this._scene.add(this._shedPoints)

    // Enemy presence light
    this._enemyLight = new THREE.PointLight(ENEMY_LIGHT_COLOR, ENEMY_LIGHT_INTENSITY, ENEMY_LIGHT_RADIUS)
    this._enemyLight.visible = false
    this._scene.add(this._enemyLight)
  }

  _showBody(val) {
    this._bodyPoints.visible = val
    this._shedPoints.visible = val
    this._enemyLight.visible = val
  }

  // ─── Main update ─────────────────────────────────────────────────────────────

  update(delta) {
    if (!this._gsm.isActive || this._state === 'inactive') return

    // Throttled line-of-sight check
    this._losFrame++
    if (this._losFrame >= LOS_CHECK_INTERVAL) {
      this._losFrame = 0
      this._losResult = this._los?.check(this._position, this._playerPosition, this._bodyPoints) ?? false
    }

    this._updateStateMachine(delta)
    this._moveTowardTarget(delta)
    this._updateProximity()
    this._updateVisuals(delta)
  }

  _updateStateMachine(delta) {
    const distToPlayer     = this._position.distanceTo(this._playerPosition)
    const detectionRadius  = DETECTION_MAX_RANGE * this._playerLightLevel
    const canDetect        = distToPlayer < detectionRadius && this._losResult

    switch (this._state) {
      case 'wandering':
        if (canDetect) { this._state = 'hunt'; break }
        if (this._position.distanceTo(this._wanderTarget) < 1.0) {
          this._state = 'idle'
          this._idleTimer = IDLE_DURATION_MIN + Math.random() * (IDLE_DURATION_MAX - IDLE_DURATION_MIN)
        }
        break

      case 'idle':
        this._idleTimer -= delta
        if (canDetect) { this._state = 'hunt'; break }
        if (this._idleTimer <= 0) { this._state = 'wandering'; this._pickWanderTarget() }
        break

      case 'hunt':
        // Catch check
        if (distToPlayer <= CATCH_DISTANCE) {
          this._state = 'inactive'
          this._showBody(false)
          this._gsm.onPlayerCaught()
          return
        }
        // Update last known LIT position (only when player is lit)
        if (this._playerLightLevel > 0) {
          this._lastKnownLitPosition = this._playerPosition.clone()
        }
        // Player hides in darkness — lose them, start searching
        if (!this._losResult || this._playerLightLevel === 0) {
          // Ensure a valid search target exists — fallback to snake's own position
          if (!this._lastKnownLitPosition) this._lastKnownLitPosition = this._position.clone()
          this._state = 'searching'
          this._searchTimer = SEARCH_DURATION
        }
        break

      case 'searching':
        this._searchTimer -= delta
        if (canDetect) { this._state = 'hunt'; break }
        if (this._searchTimer <= 0) { this._state = 'wandering'; this._pickWanderTarget() }
        break
    }
  }

  _moveTowardTarget(delta) {
    let target = null
    let speed  = WANDER_SPEED

    switch (this._state) {
      case 'wandering': target = this._wanderTarget;           speed = WANDER_SPEED;  break
      case 'hunt':      target = this._lastKnownLitPosition ?? this._wanderTarget; speed = HUNT_SPEED; break
      case 'searching': target = this._lastKnownLitPosition;   speed = SEARCH_SPEED;  break
      case 'idle':      return  // no movement while idle
      default:          return
    }

    if (!target) return

    const dir = new THREE.Vector3().subVectors(target, this._position)
    if (dir.lengthSq() < 0.01) return

    dir.normalize()
    this._forward.copy(dir)
    this._position.addScaledVector(dir, speed * delta)

    // Update path history (head position recorded each frame, tail drags behind)
    this._splineHistory.unshift(this._position.clone())
    if (this._splineHistory.length > SPLINE_HISTORY_LENGTH) this._splineHistory.pop()

    // Update surface collision data (used by snake body orientation)
    this._collision?.update(this._position, this._forward)
  }

  _pickWanderTarget() {
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * WANDER_RADIUS
    this._wanderTarget.set(
      WANDER_CENTER.x + Math.cos(angle) * r,
      1,
      WANDER_CENTER.z + Math.sin(angle) * r
    )
  }

  _updateProximity() {
    const dist = this._position.distanceTo(this._playerPosition)
    const factor = Math.max(0, 1 - dist / DETECTION_MAX_RANGE)
    this.onEnemyProximityChange?.(factor)
  }

  _updateVisuals(delta) {
    // Body particles — distributed along spline history (head to tail)
    const bodyArr = this._bodyGeo.attributes.position.array
    for (let i = 0; i < BODY_PARTICLE_COUNT; i++) {
      const histIdx = Math.floor(i * (SPLINE_HISTORY_LENGTH / BODY_PARTICLE_COUNT))
      const hPos = this._splineHistory[Math.min(histIdx, this._splineHistory.length - 1)]
      bodyArr[i * 3]     = hPos.x + (Math.random() - 0.5) * BODY_PARTICLE_SCATTER * 2
      bodyArr[i * 3 + 1] = hPos.y + (Math.random() - 0.5) * BODY_PARTICLE_SCATTER
      bodyArr[i * 3 + 2] = hPos.z + (Math.random() - 0.5) * BODY_PARTICLE_SCATTER * 2
    }
    this._bodyGeo.attributes.position.needsUpdate = true

    // Shedding particles — drift from snake toward player position
    const shedArr = this._shedGeo.attributes.position.array
    const now = performance.now() * 0.001
    for (let i = 0; i < SHED_PARTICLE_COUNT; i++) {
      // Each particle has its own phase offset — spreads out the drift
      const t = ((now * 0.15 + i * (1 / SHED_PARTICLE_COUNT)) % 1)
      const lx = this._position.x + (this._playerPosition.x - this._position.x) * t
      const ly = this._position.y + (this._playerPosition.y - this._position.y) * t + Math.sin(t * Math.PI) * 0.4
      const lz = this._position.z + (this._playerPosition.z - this._position.z) * t
      shedArr[i * 3]     = lx + (Math.random() - 0.5) * 0.2
      shedArr[i * 3 + 1] = ly
      shedArr[i * 3 + 2] = lz + (Math.random() - 0.5) * 0.2
    }
    this._shedGeo.attributes.position.needsUpdate = true

    // Enemy light follows head
    this._enemyLight.position.copy(this._position)
  }

  // ─── Public accessors ─────────────────────────────────────────────────────────

  /** @returns {THREE.Vector3} */
  get position() { return this._position }
}
