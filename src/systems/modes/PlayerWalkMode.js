// src/systems/modes/PlayerWalkMode.js
// Clean gameplay walk mode — first-person WASD + mouse, no dev overlays.

import * as THREE from 'three'

const MOUSE_SENSITIVITY  = 0.002
const PITCH_CLAMP        = Math.PI / 4 - 0.01
const STROKE_GAP_MS      = 50

const PITCH_NEUTRAL      = -0.10   // resting pitch (~6° above horizon, negative = up)
const PITCH_DRIFT_SPEED  = 0.35    // rad/s drift toward neutral when mouse is idle
const MOUSE_IDLE_MS      = 80      // ms without mouse movement before drift begins
const BOB_PITCH_AMP      = 0.0011   // peak camera pitch oscillation while walking

const BOB_SPEED_SCALE    = 2.5     // matches PlayerController
const MOVE_SPEED         = 5.0     // matches PlayerController

export class PlayerWalkMode {
  constructor(camera, entity, renderer, gsm, modeManager, tagSystem) {
    this.camera      = camera
    this._entity     = entity
    this._renderer   = renderer
    this._gsm        = gsm
    this._mm         = modeManager
    this._tagSystem  = tagSystem

    this._yaw            = 0
    this._pitch          = 0
    this._keys           = {}
    this._pointerLocked  = false

    this._strokeYaw      = 0
    this._strokePitch    = 0
    this._accumDx        = 0
    this._accumDy        = 0
    this._lastMoveMs     = 0

    this._bobPhase       = 0
    this._normSpeed      = 0
  }

  get bindings() {
    return [
      ['WASD',  'move'],
      ['Mouse', 'look'],
      ['E',     'interact'],
    ]
  }

  onEnter(_prevCamera) {
    this._mm.setCoords('')
    if (this._tagSystem) this._tagSystem.setVisible(false)
    if (this._gsm.isActive) {
      this._renderer.domElement.requestPointerLock()
    }
  }

  onExit() {
    document.exitPointerLock()
    this._entity.setBodyVisible(false)
    if (this._tagSystem) this._tagSystem.setVisible(true)
  }

  onKey(e) {
    this._keys[e.code] = true
  }

  onKeyUp(e) {
    delete this._keys[e.code]
    if (e.code === 'KeyE') this._entity.interact()
    if (e.code === 'KeyP') this._entity.toggleNikoPathVis()
  }

  onMouseMove(e) {
    if (!this._pointerLocked || this._entity.isCameraFrozen) return

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

    const fwd   = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw))
    const right  = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw))
    const dir    = new THREE.Vector3()

    if (this._keys['KeyW'] || this._keys['ArrowUp'])    dir.addScaledVector(fwd,    1)
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  dir.addScaledVector(fwd,   -1)
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  dir.addScaledVector(right, -1)
    if (this._keys['KeyD'] || this._keys['ArrowRight']) dir.addScaledVector(right,  1)
    if (dir.lengthSq() > 0) dir.normalize()

    this._entity.setFacing(this._yaw)
    this._entity.move(dir, delta)

    const ts = this._entity.timeScale

    // advance bob phase in sync with movement
    const targetNorm = dir.lengthSq() > 0 ? 1 : 0
    this._normSpeed += (targetNorm - this._normSpeed) * Math.min(1, 6 * delta * ts)
    this._bobPhase  += this._normSpeed * MOVE_SPEED * BOB_SPEED_SCALE * delta * ts

    // drift pitch toward neutral when mouse is idle
    if (performance.now() - this._lastMoveMs > MOUSE_IDLE_MS) {
      this._pitch += (PITCH_NEUTRAL - this._pitch) * Math.min(1, PITCH_DRIFT_SPEED * delta * ts)
    }

    if (!this._entity.isCameraFrozen) {
      this.camera.position.copy(this._entity.playerPosition)
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.y     = this._yaw
      this.camera.rotation.x     = this._pitch + Math.sin(this._bobPhase) * BOB_PITCH_AMP * this._normSpeed
    }
  }

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
