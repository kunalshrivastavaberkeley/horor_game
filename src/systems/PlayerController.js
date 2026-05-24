// src/systems/PlayerController.js
// Player entity — position, collision, lantern hold, auto-crouch.
// No input, no camera management. WalkMode drives this each frame.

import * as THREE from 'three'
import { PlayerCollision } from './PlayerCollision.js'
import { LANTERN } from '../lanternConfig.js'

const MOVE_SPEED           = 5.0
const MIN_MOVE_SPEED       = 1.5
const FLOOR_SEEK           = 3.0
const ARTIFACT_PICKUP_DIST = 2.5
export const DEATH_Y       = -1
const SPAWN_POS            = new THREE.Vector3(39.48, 7.0, -6.42)

const BODY_RADIUS        = 0.4
const BODY_HEIGHT        = 2.2
const CROUCH_MIN         = 0.75
const CROUCH_SPEED       = 3.0
const CROUCH_SPEED_BOOST = 4.0

const FALL_RISE           = 12.0  // intensity units/s while ungrounded
const FALL_DECAY          = 8.0   // intensity units/s while grounded
const CHECKPOINT_INTERVAL    = 3.0   // seconds between checkpoint saves
const CHECKPOINT_BUFFER_SIZE = 4     // rolling history depth — each death steps one further back

const BAIL_DURATION       = 0.45  // real seconds of slow-mo on death
const BAIL_TIMESCALE      = 0.12  // time scale factor during bail

const LANTERN_FLOAT_MAX      = 0.6     // max upward lantern offset while airborne
const LANTERN_FWD_MAX        = 0.2    // max forward offset while airborne
const LANTERN_SPRING_K       = 2      // spring stiffness for landing oscillation
const LANTERN_SPRING_DAMPING = 2      // damping coefficient
const LANTERN_IMPACT_KICK    = 10.0   // downward velocity on landing

const _Y_UP = new THREE.Vector3(0, 1, 0)

// ─── Lantern carry oscillation ────────────────────────────────────────────────
// Phase advances with walking speed; three axes at different offsets create
// a rolling oval path (figure-8 in 3D) that reads as weight in the hand.
const BOB_SPEED_SCALE = 2.5    // rad·s⁻¹ per (m/s) of horizontal speed
const BOB_VERT_AMP    = 0.038  // vertical bob amplitude  (m)
const BOB_LAT_AMP     = 0.020  // lateral sway amplitude  (m)
const BOB_FWD_AMP     = 0.014  // forward/back pump amp   (m)
const BREATHE_AMP        = 0.006  // idle breathing amplitude (calm)
const BREATHE_HZ         = 0.14   // ~8 breaths/min  (calm)
const BREATHE_AMP_SCARED = 0.011  // anxious breathing amplitude
const BREATHE_HZ_SCARED  = 0.38   // ~23 breaths/min (scared)
const LOOK_LAG_DECAY  = 7.0    // EMA decay for yaw-velocity smoothing
const LOOK_LAG_SCALE  = 0.048  // lateral offset per rad/s of yaw velocity

const PATH_DOT_COUNT = 9

export class PlayerController {
  constructor(sceneManagement, gsm) {
    this._sm  = sceneManagement
    this._gsm = gsm

    this.playerPosition  = SPAWN_POS.clone()
    this.movementState   = 'idle'   // 'idle' | 'walking'
    this.lanternState    = 'held'   // 'held' | 'hugging'

    this.lanternConst = {
      fwdHeld:   LANTERN.heldFwd,
      rightHeld: LANTERN.heldRight,
      upHeld:    LANTERN.heldUp,
      fwdHug:    LANTERN.hugFwd,
      rightHug:  LANTERN.hugRight,
      upHug:     LANTERN.hugUp,
      lerpSpeed: LANTERN.lerpSpeed,
      ctrlRight: LANTERN.arcRight,
      ctrlDown:  LANTERN.arcDown,
    }

    this._facing             = 0
    this._currentBodyHeight  = BODY_HEIGHT
    this._horizontalSpeed    = 0
    this._cameraFrozen       = false

    this._fallIntensity      = 0
    this._isGrounded         = true
    this._prevGrounded       = true
    this._lanternVertOffset  = 0
    this._lanternVertVel     = 0
    this._lanternFwdOffset   = 0
    this._lanternFwdVel      = 0
    this._checkpointHistory  = [SPAWN_POS.clone()]  // oldest first; spawn is permanent floor
    this._checkpointTimer    = 0
    this._bailTimer          = 0

    this._bobPhase       = 0
    this._smoothSpeed    = 0              // amplitude envelope — ramps up/down to kill snap on start/stop
    this._lanternOscOffset = new THREE.Vector3()  // lerped oscillation offset
    this._prevFacing     = null           // null = not yet initialized; set on first update
    this._yawVel         = 0              // smoothed yaw velocity for look-lag
    this._moveDir        = null           // normalized horizontal movement direction
    this._artifactPickedUp   = false
    this._showBodies         = false
    this._lanternLerpT       = 0

    this._camera        = null
    this._collision     = null
    this._lanternMesh   = null
    this._playerMesh    = null
    this._cameraHelper  = null
    this._pathVis       = null

    this._lanternEnabled = true

    // Callbacks — assigned by main.js
    this.onArtifactPickedUp   = null
    this.onLanternStateChange = null
    this.onPause              = null
  }

  // ─── Camera / mesh setup ─────────────────────────────────────────────────────

  initCollision() {
    if (!this._collision) {
      this._collision = new PlayerCollision(this._sm.getCatacombMesh())
    }
  }

  setCamera(cam) {
    this._camera = cam
    this._camera.position.copy(this.playerPosition)
    this.initCollision()
    if (this._lanternMesh) this._lanternMesh.visible = this._lanternEnabled
    this._initPlayerMesh()
  }

  releaseCamera() {
    this._camera = null
    // lanternMesh stays visible — detached modes show the body at its last position
  }

  setLanternVisible(v) {
    this._lanternEnabled = v
    if (this._lanternMesh) this._lanternMesh.visible = v
  }

  // Attaches camera reference for lantern updates without the full setCamera side-effects.
  // Used by fly mode so meshes follow the camera even though the physics body is detached.
  setLanternCamera(cam) {
    this._camera = cam
  }

  setLanternMesh(mesh) {
    this._lanternMesh = mesh
    this._lanternMesh.scale.setScalar(LANTERN.scale)
    this._lanternMesh.visible = false
  }

  setLanternSheen(v) {
    if (!this._lanternMesh) return
    this._lanternMesh.traverse(o => { if (o.isMesh) o.material.sheen = v })
  }

  setLanternSheenRoughness(v) {
    if (!this._lanternMesh) return
    this._lanternMesh.traverse(o => { if (o.isMesh) o.material.sheenRoughness = v })
  }

  get collision() { return this._collision }

  // ─── Public interface for modes ───────────────────────────────────────────────

  teleportTo(x, z) {
    this.playerPosition.set(x, this.playerPosition.y, z)
  }

  setFacing(yaw) { this._facing = yaw }
  getFacing()    { return this._facing }

  freezeCamera(val) { this._cameraFrozen = val }
  get isCameraFrozen() { return this._cameraFrozen }
  get fallIntensity()  { return this._fallIntensity }
  get timeScale()      { return this._bailTimer > 0 ? BAIL_TIMESCALE : 1.0 }
  get isGrounded()     { return this._isGrounded }

  setBodyVisible(val) { this._showBodies = val }

  toggleLanternPathVis() {
    if (this._pathVis) { this._destroyPathVis(); return false }
    this._initPathVis()
    return true
  }

  setLanternPathVis(v) {
    if (v && !this._pathVis) this._initPathVis()
    else if (!v && this._pathVis) this._destroyPathVis()
  }

  move(direction, delta) {
    if (this._bailTimer > 0) {
      this._bailTimer -= delta
      if (this._bailTimer <= 0) {
        this._bailTimer = 0
        // Pop the most recent checkpoint so a quick repeat death steps further back.
        // Always keep at least one entry (the original spawn fallback).
        if (this._checkpointHistory.length > 1) this._checkpointHistory.pop()
        this.playerPosition.copy(this._checkpointHistory[this._checkpointHistory.length - 1])
        this._currentBodyHeight = BODY_HEIGHT
        this._fallIntensity     = 0
        this._checkpointTimer   = 0
      }
      return
    }

    const feetY = this.playerPosition.y - this._currentBodyHeight
    if (this._collision) {
      const available  = this._collision.findCeiling(this.playerPosition.x, feetY, this.playerPosition.z)
      const targetH    = Math.max(CROUCH_MIN, Math.min(BODY_HEIGHT, available - BODY_RADIUS))
      const descending = targetH < this._currentBodyHeight
      const boost      = descending
        ? 1.0 + (this._horizontalSpeed / MOVE_SPEED) * CROUCH_SPEED_BOOST
        : 1.0
      this._currentBodyHeight += (targetH - this._currentBodyHeight)
        * Math.min(1, CROUCH_SPEED * boost * delta)
      this.playerPosition.y = feetY + this._currentBodyHeight
    }

    const crouchT = (BODY_HEIGHT - this._currentBodyHeight) / (BODY_HEIGHT - CROUCH_MIN)
    const speed   = MOVE_SPEED + (MIN_MOVE_SPEED - MOVE_SPEED) * crouchT

    const isMoving = direction.lengthSq() > 0
    if (isMoving) {
      this.movementState    = 'walking'
      this._horizontalSpeed = speed
      this._moveDir         = direction.clone().normalize()
    } else {
      this.movementState    = 'idle'
      this._horizontalSpeed = 0
      this._moveDir         = null
    }

    const intendedMove = direction.clone().multiplyScalar(speed * delta)
    intendedMove.y = -FLOOR_SEEK * delta

    let isGrounded = false
    if (this._collision) {
      const { resolvedMove, isGrounded: g } = this._collision.resolve(
        this.playerPosition, intendedMove, this._currentBodyHeight
      )
      this.playerPosition.add(resolvedMove)
      isGrounded = g
    } else {
      this.playerPosition.add(intendedMove)
      isGrounded = true
    }

    this._isGrounded    = isGrounded
    this._fallIntensity = isGrounded
      ? Math.max(0, this._fallIntensity - FALL_DECAY * delta)
      : Math.min(1, this._fallIntensity + FALL_RISE * delta)

    if (isGrounded && this._fallIntensity === 0) {
      this._checkpointTimer += delta
      if (this._checkpointTimer >= CHECKPOINT_INTERVAL) {
        this._checkpointHistory.push(this.playerPosition.clone())
        if (this._checkpointHistory.length > CHECKPOINT_BUFFER_SIZE) this._checkpointHistory.shift()
        this._checkpointTimer = 0
      }
    } else {
      this._checkpointTimer = 0
    }

    if (this.playerPosition.y < DEATH_Y) {
      this._bailTimer = BAIL_DURATION
    }
  }

  interact() {
    if (!this._gsm.isActive) return
    if (!this._artifactPickedUp) {
      const artifactPos = this._sm.getArtifactPosition?.()
      if (artifactPos && this.playerPosition.distanceTo(artifactPos) <= ARTIFACT_PICKUP_DIST) {
        this._artifactPickedUp = true
        this.onArtifactPickedUp?.()
        return
      }
    }
    this.lanternState = this.lanternState === 'held' ? 'hugging' : 'held'
    this.onLanternStateChange?.(this.lanternState)
  }

  // ─── Per-frame visuals ────────────────────────────────────────────────────────

  update(delta) {
    this._updatePlayerMesh()
    if (!this._camera) return
    this._updateLantern(delta)
    this._updatePathVis()
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _updateLantern(delta) {
    if (!this._lanternMesh || !this._camera || this._cameraFrozen) return

    const c = this.lanternConst
    const target = this.lanternState === 'hugging' ? 1 : 0
    this._lanternLerpT += (target - this._lanternLerpT) * Math.min(1, c.lerpSpeed * delta)

    const yaw   = this._facing
    const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const right = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw))

    const basePos = this._lanternPathPoint(this._lanternLerpT, fwd, right)

    // ─── 3-axis carry oscillation ─────────────────────────────────────────────
    const speed = this._horizontalSpeed

    // Smooth the amplitude envelope: ramp up fast, fade out a bit slower.
    const ramp = speed > this._smoothSpeed ? 9.0 : 5.0
    this._smoothSpeed += (speed - this._smoothSpeed) * Math.min(1, ramp * delta)
    const normSpeed = this._smoothSpeed / MOVE_SPEED  // 0–1, no sudden jumps

    // Phase advances with actual walking speed → bob frequency tracks cadence
    this._bobPhase += speed * BOB_SPEED_SCALE * delta

    // Decompose movement direction into camera-relative fwd component
    let fwdDot = 0
    if (this._moveDir) {
      fwdDot = this._moveDir.dot(fwd)
    }

    // Moving forward/back → full vertical bob + forward pump.
    // Pure strafe → vertical reduced, pump silent.
    const fwdWeight = Math.abs(fwdDot)  // 0 (pure strafe) … 1 (pure fwd/back)

    // Hugging = scared: tighter grip reduces swing; breathing goes anxious.
    const scaredT   = this._lanternLerpT
    const gripScale = 1.0 - 0.35 * scaredT  // tense grip damps the oscillation

    const ph = this._bobPhase
    const oscUp    = Math.sin(ph)       * BOB_VERT_AMP * normSpeed * (0.45 + 0.55 * fwdWeight) * gripScale
    const oscRight = Math.cos(ph)       * BOB_LAT_AMP  * normSpeed * gripScale  // 90° → rolling oval
    const oscFwdV  = Math.sin(ph * 2)   * BOB_FWD_AMP  * normSpeed * fwdWeight  * gripScale   // 2× freq

    // Breathing blends from calm (8/min) to anxious (23/min) as scaredT rises
    const now        = performance.now() / 1000
    const breatheHz  = BREATHE_HZ  + (BREATHE_HZ_SCARED  - BREATHE_HZ)  * scaredT
    const breatheAmp = BREATHE_AMP + (BREATHE_AMP_SCARED - BREATHE_AMP) * scaredT
    const breathe    = Math.sin(now * Math.PI * 2 * breatheHz) * breatheAmp * (1 - normSpeed)

    // Look-lag — object drifts laterally opposite to yaw rotation, reads as inertia
    if (this._prevFacing === null) this._prevFacing = yaw
    const yawRate = delta > 0.001 ? (yaw - this._prevFacing) / delta : 0
    this._prevFacing = yaw
    this._yawVel += (yawRate - this._yawVel) * Math.min(1, LOOK_LAG_DECAY * delta)
    const lagRight = -this._yawVel * LOOK_LAG_SCALE

    // Combine target offset, then lerp the persistent offset toward it.
    const targetOsc = right.clone().multiplyScalar(oscRight + lagRight)
      .addScaledVector(_Y_UP, oscUp + breathe)
      .addScaledVector(fwd,   oscFwdV)

    this._lanternOscOffset.lerp(targetOsc, Math.min(1, 14 * delta))

    // Fall float + landing spring applied to lantern's world position
    const fi            = this._fallIntensity
    const landed        = this._isGrounded && !this._prevGrounded
    this._prevGrounded  = this._isGrounded

    const targetVert = this._isGrounded ? 0 : fi * LANTERN_FLOAT_MAX
    const targetFwd  = this._isGrounded ? 0 : fi * LANTERN_FWD_MAX
    this._lanternVertOffset += (targetVert - this._lanternVertOffset) * Math.min(1, 12 * delta)
    this._lanternFwdOffset  += (targetFwd  - this._lanternFwdOffset)  * Math.min(1, 12 * delta)

    if (landed) {
      this._lanternVertVel = -LANTERN_IMPACT_KICK * fi
      this._lanternFwdVel  = -LANTERN_IMPACT_KICK * fi * 0.4
    }
    if (this._isGrounded) {
      this._lanternVertVel    += (-this._lanternVertOffset * LANTERN_SPRING_K - this._lanternVertVel * LANTERN_SPRING_DAMPING) * delta
      this._lanternVertOffset += this._lanternVertVel * delta
      this._lanternFwdVel     += (-this._lanternFwdOffset  * LANTERN_SPRING_K - this._lanternFwdVel  * LANTERN_SPRING_DAMPING) * delta
      this._lanternFwdOffset  += this._lanternFwdVel * delta
    }

    this._lanternMesh.position.copy(basePos).add(this._lanternOscOffset)
    this._lanternMesh.position.y += this._lanternVertOffset
    this._lanternMesh.position.addScaledVector(fwd, this._lanternFwdOffset)

    // ─── Orientation ──────────────────────────────────────────────────────────
    // held = faces away from player, hugging = faces player
    const lookAwayPt = this._lanternMesh.position.clone().add(fwd)
    this._lanternMesh.lookAt(lookAwayPt)
    const quatAway   = this._lanternMesh.quaternion.clone()

    const rotLeftY   = new THREE.Quaternion().setFromAxisAngle(_Y_UP, Math.PI)
    const quatToward = new THREE.Quaternion().multiplyQuaternions(rotLeftY, quatAway)

    this._lanternMesh.quaternion.slerpQuaternions(quatAway, quatToward, this._lanternLerpT)
  }

  _lanternPathPoint(t, fwd, right) {
    const c   = this.lanternConst
    const cam = this._camera.position

    const p0 = cam.clone()
      .addScaledVector(fwd,   c.fwdHeld)
      .addScaledVector(right, c.rightHeld)
      .add(new THREE.Vector3(0, c.upHeld, 0))

    const p2 = cam.clone()
      .addScaledVector(fwd,   c.fwdHug)
      .addScaledVector(right, c.rightHug)
      .add(new THREE.Vector3(0, c.upHug, 0))

    const p1 = p0.clone().add(p2).multiplyScalar(0.5)
      .addScaledVector(right, c.ctrlRight)
      .add(new THREE.Vector3(0, c.ctrlDown, 0))

    const mt = 1 - t
    return p0.multiplyScalar(mt * mt)
      .addScaledVector(p1, 2 * mt * t)
      .addScaledVector(p2, t * t)
  }

  // ─── Path visualizer ─────────────────────────────────────────────────────────

  _initPathVis() {
    const scene = this._gsm.scene
    const dots = []
    for (let i = 0; i < PATH_DOT_COUNT; i++) {
      const t = i / (PATH_DOT_COUNT - 1)
      const r = Math.round(t * 255)
      const g = Math.round((1 - t) * 255)
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(i === 0 || i === PATH_DOT_COUNT - 1 ? 0.045 : 0.022, 8, 8),
        new THREE.MeshBasicMaterial({ color: (r << 16) | (g << 8), depthTest: false })
      )
      dot.renderOrder = 1000
      scene.add(dot)
      dots.push(dot)
    }

    const positions = new Float32Array(PATH_DOT_COUNT * 3)
    const lineGeo   = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, opacity: 0.5, transparent: true })
    )
    line.renderOrder = 999
    scene.add(line)

    const liveDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false })
    )
    liveDot.renderOrder = 1001
    scene.add(liveDot)

    this._pathVis = { dots, line, liveDot }
    window.__lantern = this.lanternConst
    console.log('[LanternPathVis] on — tweak via window.__lantern')
  }

  _updatePathVis() {
    if (!this._pathVis || !this._camera) return

    const yaw   = this._facing
    const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const right = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw))
    const positions = this._pathVis.line.geometry.attributes.position.array

    for (let i = 0; i < PATH_DOT_COUNT; i++) {
      const pos = this._lanternPathPoint(i / (PATH_DOT_COUNT - 1), fwd, right)
      this._pathVis.dots[i].position.copy(pos)
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z
    }
    this._pathVis.line.geometry.attributes.position.needsUpdate = true
    this._pathVis.liveDot.position.copy(this._lanternPathPoint(this._lanternLerpT, fwd, right))
  }

  _destroyPathVis() {
    if (!this._pathVis) return
    const scene = this._gsm.scene
    for (const d of this._pathVis.dots) scene.remove(d)
    scene.remove(this._pathVis.line)
    scene.remove(this._pathVis.liveDot)
    this._pathVis = null
    delete window.__lantern
    console.log('[LanternPathVis] off')
  }

  // ─── Player body debug ───────────────────────────────────────────────────────

  _updatePlayerMesh() {
    if (!this._playerMesh) return
    const show  = this._showBodies
    const h     = this._currentBodyHeight
    const feetY = this.playerPosition.y - h
    const ys    = [feetY + BODY_RADIUS, feetY + h * 0.5, feetY + h - BODY_RADIUS]
    for (let i = 0; i < 3; i++) {
      this._playerMesh[i].visible = show
      if (show) this._playerMesh[i].position.set(this.playerPosition.x, ys[i], this.playerPosition.z)
    }
    if (this._cameraHelper) {
      this._cameraHelper.visible = show
      if (show) this._cameraHelper.update()
    }
  }

  _initPlayerMesh() {
    if (this._playerMesh) return
    const geo = new THREE.SphereGeometry(BODY_RADIUS, 12, 8)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.5, depthWrite: false
    })
    this._playerMesh = [
      new THREE.Mesh(geo, mat),
      new THREE.Mesh(geo, mat),
      new THREE.Mesh(geo, mat),
    ]
    for (const s of this._playerMesh) {
      s.visible = false
      this._gsm.scene.add(s)
    }
    this._cameraHelper = new THREE.CameraHelper(this._camera)
    this._cameraHelper.visible = false
    this._gsm.scene.add(this._cameraHelper)
  }
}
