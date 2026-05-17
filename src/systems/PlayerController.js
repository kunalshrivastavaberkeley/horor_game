import * as THREE from 'three'
import { PlayerCollision } from './PlayerCollision.js'

// Tunable constants
const MOVE_SPEED = 5.0                    // units/second
const MOUSE_SENSITIVITY = 0.002           // radians per pixel
const PITCH_CLAMP = Math.PI / 2 - 0.01   // max look up/down
const ARTIFACT_PICKUP_DISTANCE = 2.5     // world units
const EYE_HEIGHT = 0.9                   // above ground Y

export class PlayerController {
  /**
   * @param {import('./SceneManagement.js').SceneManagement} sceneManagement
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(sceneManagement, gsm) {
    this._sm = sceneManagement
    this._gsm = gsm

    // Public state — read by other systems
    this.playerPosition = new THREE.Vector3(0, EYE_HEIGHT, 5)
    this.movementState = 'idle'   // 'idle' | 'walking'
    this.nikoState = 'held'       // 'held' | 'hugging'

    // Internal state
    this._yaw = 0
    this._pitch = 0
    this._camera = null
    this._collision = null
    this._zone = 'desert'
    this._pointerLocked = false
    this._artifactPickedUp = false
    this._cameraFrozen = false   // set true by PostProcessing during hug sequence
    this._keys = {}

    // Callbacks — assigned externally by main.js
    this.onArtifactPickedUp = null    // () => void
    this.onPause = null               // () => void
    this.onNikoStateChange = null     // (state: string) => void

    this._bindInputs()
  }

  /**
   * Called by GSM on DESERT/TEMPLE enter.
   * Attaches camera to player and initializes collision.
   * @param {THREE.PerspectiveCamera} cam
   */
  setCamera(cam) {
    this._camera = cam
    this._camera.position.copy(this.playerPosition)
    this._collision = new PlayerCollision(
      this._sm.getDesertMesh(),
      this._sm.getTempleMesh()
    )
  }

  /**
   * Called by GSM on state exit — release camera reference.
   */
  releaseCamera() {
    this._camera = null
  }

  /**
   * Set which zone the player is in — affects ground mesh priority.
   * @param {'desert'|'temple'} zone
   */
  setZone(zone) {
    this._zone = zone
  }

  /**
   * Called by PostProcessing to freeze/unfreeze camera input during hug sequence.
   * @param {boolean} val
   */
  freezeCamera(val) {
    this._cameraFrozen = val
  }

  /**
   * World position of Niko — approximated as slightly in front of camera.
   * @returns {THREE.Vector3}
   */
  get nikoPosition() {
    if (!this._camera) return this.playerPosition.clone()
    const forward = new THREE.Vector3()
    this._camera.getWorldDirection(forward)
    return this.playerPosition.clone().addScaledVector(forward, 0.5).add(new THREE.Vector3(0, -0.2, 0))
  }

  _bindInputs() {
    document.addEventListener('keydown', e => {
      this._keys[e.code] = true
    })

    document.addEventListener('keyup', e => {
      this._keys[e.code] = false
      if (e.code === 'KeyE') this._handleEPress()
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
        this._gsm.onPause()
      }
    })

    document.addEventListener('click', () => {
      if (this._gsm.isActive && !this._pointerLocked) {
        document.body.requestPointerLock()
      }
    })
  }

  _handleEPress() {
    if (!this._gsm.isActive) return

    // Artifact pickup check
    if (!this._artifactPickedUp) {
      const artifactPos = this._sm.getArtifactPosition?.()
      if (artifactPos) {
        const dist = this.playerPosition.distanceTo(artifactPos)
        if (dist <= ARTIFACT_PICKUP_DISTANCE) {
          this._artifactPickedUp = true
          this.onArtifactPickedUp?.()
          return  // E consumed by pickup
        }
      }
    }

    // Niko toggle
    if (this.nikoState === 'held') {
      this.nikoState = 'hugging'
    } else {
      this.nikoState = 'held'
    }
    this.onNikoStateChange?.(this.nikoState)
  }

  update(delta) {
    if (!this._gsm.isActive || !this._camera) return

    this._updateMovement(delta)
    this._updateCamera()
  }

  _updateMovement(delta) {
    // Movement locked while hugging
    if (this.nikoState === 'hugging') {
      this.movementState = 'hugging'
      return
    }

    // Build movement vector from input (relative to yaw only — no pitch on movement)
    const forward = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw))
    const right   = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw))

    const intendedMove = new THREE.Vector3()
    if (this._keys['KeyW'] || this._keys['ArrowUp'])    intendedMove.addScaledVector(forward, 1)
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  intendedMove.addScaledVector(forward, -1)
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  intendedMove.addScaledVector(right, -1)
    if (this._keys['KeyD'] || this._keys['ArrowRight']) intendedMove.addScaledVector(right, 1)

    const isMoving = intendedMove.lengthSq() > 0
    if (isMoving) {
      intendedMove.normalize().multiplyScalar(MOVE_SPEED * delta)
      this.movementState = 'walking'
    } else {
      this.movementState = 'idle'
    }

    // Resolve with collision
    if (this._collision) {
      const { resolvedMove, groundY } = this._collision.resolve(
        this.playerPosition, intendedMove, this._zone
      )
      this.playerPosition.add(resolvedMove)
      this.playerPosition.y = groundY + EYE_HEIGHT
    } else {
      // No collision system — apply directly (dev fallback)
      this.playerPosition.add(intendedMove)
    }
  }

  _updateCamera() {
    if (this._cameraFrozen) return
    this._camera.position.copy(this.playerPosition)
    this._camera.rotation.order = 'YXZ'
    this._camera.rotation.y = this._yaw
    this._camera.rotation.x = this._pitch
  }
}
