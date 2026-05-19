// src/systems/modes/WalkMode.js
// Walk mode — first-person camera, drives PlayerController entity with WASD + mouse.
// Used for both in-game play and dev on-foot exploration.

import * as THREE from 'three'

const MOUSE_SENSITIVITY = 0.002
const PITCH_CLAMP       = Math.PI / 4 - 0.01
// Gap longer than this (ms) between mousemove events marks a new stroke.
// Within a stroke, yaw/pitch are computed from a fixed baseline so circular
// motion on a trackpad is path-independent (Shamblog trackball technique).
const STROKE_GAP_MS     = 50

export class WalkMode {
  /**
   * @param {THREE.PerspectiveCamera} camera     gsm.camera — first-person view
   * @param {import('../PlayerController.js').PlayerController} entity
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('../../GameStateMachine/index.js').GameStateMachine} gsm
   * @param {import('../ModeManager.js').ModeManager} modeManager
   */
  constructor(camera, entity, renderer, gsm, modeManager) {
    this.camera       = camera
    this._entity      = entity
    this._renderer    = renderer
    this._gsm         = gsm
    this._mm          = modeManager

    this._yaw         = 0
    this._pitch       = 0
    this._keys        = {}
    this._pointerLocked = false

    this._strokeYaw   = 0
    this._strokePitch = 0
    this._accumDx     = 0
    this._accumDy     = 0
    this._lastMoveMs  = 0
  }

  // ─── Mode interface ───────────────────────────────────────────────────────────

  get bindings() {
    return [
      ['WASD',        'move'],
      ['Mouse',       'look'],
      ['E',           'interact'],
    ]
  }

  onEnter(_prevCamera) {
    if (this._gsm.isActive) {
      this._renderer.domElement.requestPointerLock()
    }
  }

  onExit() {
    document.exitPointerLock()
    this._entity.setBodyVisible(false)
  }

  onKey(e) {
    this._keys[e.code] = true
  }

  onKeyUp(e) {
    delete this._keys[e.code]
    if (e.code === 'KeyE') this._entity.interact()
  }

  onMouseMove(e) {
    if (!this._pointerLocked || this._entity.isCameraFrozen) return
    if (this._entity.nikoState === 'hugging') return

    const now = performance.now()
    if (now - this._lastMoveMs > STROKE_GAP_MS) {
      this._strokeYaw   = this._yaw
      this._strokePitch = this._pitch
      this._accumDx     = 0
      this._accumDy     = 0
    }
    this._lastMoveMs = now

    this._accumDx += e.movementX
    this._accumDy += e.movementY
    this._yaw     = this._strokeYaw   - this._accumDx * MOUSE_SENSITIVITY
    this._pitch   = this._strokePitch - this._accumDy * MOUSE_SENSITIVITY
    this._pitch   = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this._pitch))
  }

  onPointerLockChange(locked) {
    this._pointerLocked = locked
    if (!locked && this._gsm.isActive) {
      this._entity.onPause?.()
    }
  }

  onClick(_e) {
    if (this._gsm.isActive && !this._pointerLocked) {
      this._renderer.domElement.requestPointerLock()
    }
  }

  update(delta) {
    if (!this._gsm.isActive) return

    // Build horizontal direction from yaw + held keys
    const fwd   = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw))
    const right  = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw))
    const dir    = new THREE.Vector3()

    if (this._keys['KeyW'] || this._keys['ArrowUp'])    dir.addScaledVector(fwd,    1)
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  dir.addScaledVector(fwd,   -1)
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  dir.addScaledVector(right, -1)
    if (this._keys['KeyD'] || this._keys['ArrowRight']) dir.addScaledVector(right,  1)
    if (dir.lengthSq() > 0) dir.normalize()

    this._entity.setFacing(this._yaw)

    const prevCamPos = this.camera.position.clone()
    this._entity.move(dir, delta)

    // Position first-person camera — clamp against walls so the eye never
    // crosses geometry even if the body collision misses at head height.
    if (!this._entity.isCameraFrozen) {
      const collision = this._entity.collision
      const target    = this._entity.playerPosition
      const camPos    = collision
        ? collision.clampCameraPosition(prevCamPos, target)
        : target.clone()
      this.camera.position.copy(camPos)
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.y     = this._yaw
      this.camera.rotation.x     = this._pitch
    }

    // Coords HUD
    const p = this._entity.playerPosition
    this._mm.setCoords(`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`)
  }

  // ─── Public helpers (for mode transitions) ────────────────────────────────────

  get lookAngles() { return { yaw: this._yaw, pitch: this._pitch } }

  setLookAngles(yaw, pitch) {
    this._yaw         = yaw
    this._pitch       = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, pitch))
    this._strokeYaw   = this._yaw
    this._strokePitch = this._pitch
    this._accumDx     = 0
    this._accumDy     = 0
  }
}
