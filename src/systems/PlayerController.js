// src/systems/PlayerController.js
// Player entity — position, collision, niko hold, auto-crouch.
// No input, no camera management. WalkMode drives this each frame.

import * as THREE from 'three'
import { PlayerCollision } from './PlayerCollision.js'
import { NIKO } from '../nikoConfig.js'

const MOVE_SPEED           = 5.0
const MIN_MOVE_SPEED       = 1.5
const FLOOR_SEEK           = 3.0
const ARTIFACT_PICKUP_DIST = 2.5
const DEATH_Y              = -20
const SPAWN_POS            = new THREE.Vector3(-53.0, 5, -28.9)

const BODY_RADIUS        = 0.4
const BODY_HEIGHT        = 1.8
const CROUCH_MIN         = 0.75
const CROUCH_SPEED       = 5.0
const CROUCH_SPEED_BOOST = 4.0

const _Y_UP = new THREE.Vector3(0, 1, 0)

// ─── Niko carry oscillation ───────────────────────────────────────────────────
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
    this.nikoState       = 'held'   // 'held' | 'hugging'

    // Live-tweakable copy of nikoConfig.js values.
    // Edit nikoConfig.js to change the defaults, or use window.__niko in the
    // browser console to tune at runtime while the path visualizer (P) is on.
    this.nikoConst = {
      fwdHeld:   NIKO.heldFwd,
      rightHeld: NIKO.heldRight,
      upHeld:    NIKO.heldUp,
      fwdHug:    NIKO.hugFwd,
      rightHug:  NIKO.hugRight,
      upHug:     NIKO.hugUp,
      lerpSpeed: NIKO.lerpSpeed,
      ctrlRight: NIKO.arcRight,
      ctrlDown:  NIKO.arcDown,
    }

    this._facing             = 0
    this._currentBodyHeight  = BODY_HEIGHT
    this._horizontalSpeed    = 0
    this._cameraFrozen       = false

    this._bobPhase    = 0
    this._smoothSpeed = 0              // amplitude envelope — ramps up/down to kill snap on start/stop
    this._nikoOscOffset = new THREE.Vector3()  // lerped oscillation offset — smooths any discontinuity
    this._prevFacing  = null           // null = not yet initialized; set on first update
    this._yawVel      = 0              // smoothed yaw velocity for look-lag
    this._moveDir     = null           // normalized horizontal movement direction
    this._artifactPickedUp   = false
    this._showBodies         = false
    this._nikoLerpT          = 0

    this._camera        = null
    this._collision     = null
    this._nikoMesh      = null
    this._thumbSprite   = null
    this._fingersSprite = null
    this._playerBody    = null
    this._cameraHelper = null
    this._pathVis      = null

    // Callbacks — assigned by main.js
    this.onArtifactPickedUp = null
    this.onNikoStateChange  = null
    this.onPause            = null
  }

  // ─── Camera / mesh setup ─────────────────────────────────────────────────────

  setCamera(cam) {
    this._camera = cam
    this._camera.position.copy(this.playerPosition)
    this._collision = new PlayerCollision(this._sm.getCatacombMesh())
    if (this._nikoMesh)      this._nikoMesh.visible      = true
    if (this._thumbSprite)   this._thumbSprite.visible   = true
    if (this._fingersSprite) this._fingersSprite.visible = true
    this._initPlayerBody()
  }

  releaseCamera() {
    this._camera = null
    if (this._nikoMesh)      this._nikoMesh.visible      = false
    if (this._thumbSprite)   this._thumbSprite.visible   = false
    if (this._fingersSprite) this._fingersSprite.visible = false
  }

  setNikoMesh(mesh) {
    this._nikoMesh = mesh
    this._nikoMesh.scale.setScalar(NIKO.scale)
    this._nikoMesh.visible = false
  }

  setHandSprites(thumbSprite, fingersSprite) {
    this._thumbSprite = thumbSprite
    this._thumbSprite.scale.setScalar(NIKO.thumbScale)
    this._thumbSprite.visible = false

    this._fingersSprite = fingersSprite
    this._fingersSprite.scale.setScalar(NIKO.fingersScale)
    this._fingersSprite.visible = false
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

  setBodyVisible(val) { this._showBodies = val }

  toggleNikoPathVis() {
    if (this._pathVis) { this._destroyPathVis(); return false }
    this._initPathVis()
    return true
  }

  move(direction, delta) {
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

    if (this._collision) {
      const { resolvedMove } = this._collision.resolve(
        this.playerPosition, intendedMove, this._currentBodyHeight
      )
      this.playerPosition.add(resolvedMove)
    } else {
      this.playerPosition.add(intendedMove)
    }

    if (this.playerPosition.y < DEATH_Y) {
      this.playerPosition.copy(SPAWN_POS)
      this._currentBodyHeight = BODY_HEIGHT
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
    this.nikoState = this.nikoState === 'held' ? 'hugging' : 'held'
    this.onNikoStateChange?.(this.nikoState)
  }

  // ─── Per-frame visuals ────────────────────────────────────────────────────────

  update(delta) {
    if (!this._camera) return
    this._updateNiko(delta)
    this._updatePathVis()
    this._updatePlayerBody()
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _updateNiko(delta) {
    if (!this._nikoMesh || !this._camera || this._cameraFrozen) return

    const c = this.nikoConst
    const target = this.nikoState === 'hugging' ? 1 : 0
    this._nikoLerpT += (target - this._nikoLerpT) * Math.min(1, c.lerpSpeed * delta)

    const yaw   = this._facing
    const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const right = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw))

    const basePos = this._nikoPathPoint(this._nikoLerpT, fwd, right)

    // ─── 3-axis carry oscillation ─────────────────────────────────────────────
    const speed = this._horizontalSpeed

    // Smooth the amplitude envelope: ramp up fast, fade out a bit slower.
    // Phase still uses raw speed so bob frequency stays in sync with footsteps.
    const ramp = speed > this._smoothSpeed ? 9.0 : 5.0
    this._smoothSpeed += (speed - this._smoothSpeed) * Math.min(1, ramp * delta)
    const normSpeed = this._smoothSpeed / MOVE_SPEED  // 0–1, no sudden jumps

    // Phase advances with actual walking speed → bob frequency tracks cadence
    this._bobPhase += speed * BOB_SPEED_SCALE * delta

    // Decompose movement direction into camera-relative fwd / strafe components
    let fwdDot = 0, rightDot = 0
    if (this._moveDir) {
      fwdDot   = this._moveDir.dot(fwd)
      rightDot = this._moveDir.dot(right)
    }

    // Moving forward/back → full vertical bob + forward pump.
    // Pure strafe → vertical reduced, pump silent (arm doesn't pump sideways).
    const fwdWeight = Math.abs(fwdDot)  // 0 (pure strafe) … 1 (pure fwd/back)

    // Hugging = scared: tighter grip reduces swing; breathing goes anxious.
    // _nikoLerpT smoothly blends 0 (held/calm) → 1 (hugging/scared).
    const scaredT   = this._nikoLerpT
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
    // Lerping the offset (not the world position) means Niko tracks the camera
    // immediately but any oscillation discontinuity eases out over ~5 frames.
    const targetOsc = right.clone().multiplyScalar(oscRight + lagRight)
      .addScaledVector(_Y_UP, oscUp + breathe)
      .addScaledVector(fwd,   oscFwdV)

    this._nikoOscOffset.lerp(targetOsc, Math.min(1, 14 * delta))
    this._nikoMesh.position.copy(basePos).add(this._nikoOscOffset)

    // ─── Orientation (unchanged) ──────────────────────────────────────────────
    // held = faces away from player, hugging = faces player
    // derive quatToward by rotating quatAway 180° around +Y (left turn)
    const lookAwayPt = this._nikoMesh.position.clone().add(fwd)
    this._nikoMesh.lookAt(lookAwayPt)
    const quatAway   = this._nikoMesh.quaternion.clone()

    const rotLeftY   = new THREE.Quaternion().setFromAxisAngle(_Y_UP, Math.PI)
    const quatToward = new THREE.Quaternion().multiplyQuaternions(rotLeftY, quatAway)

    this._nikoMesh.quaternion.slerpQuaternions(quatAway, quatToward, this._nikoLerpT)

    // ─── Hand billboard positions (shared anchor, different render layers) ────
    if (this._thumbSprite || this._fingersSprite) {
      // Start from basePos + same oscillation offset Niko uses, then apply the
      // hand's own screen-space offsets. This means every bob/breathe/look-lag
      // that moves Niko moves the hand identically.
      const handPos = basePos.clone()
        .add(this._nikoOscOffset)
        .addScaledVector(right, NIKO.handRight)
        .addScaledVector(_Y_UP, NIKO.handUp)
        .addScaledVector(fwd,   NIKO.handFwd)

      const handVisible = this._nikoLerpT < 0.5
      if (this._fingersSprite) {
        this._fingersSprite.visible = handVisible
        this._fingersSprite.position.copy(handPos)
        this._fingersSprite.scale.setScalar(NIKO.fingersScale)
        // Mesh billboard — copy camera quaternion so it always faces the player.
        this._fingersSprite.quaternion.copy(this._camera.quaternion)
      }
      if (this._thumbSprite) {
        this._thumbSprite.visible = handVisible
        this._thumbSprite.position.copy(handPos)
        this._thumbSprite.scale.setScalar(NIKO.thumbScale)
      }
    }
  }

  _nikoPathPoint(t, fwd, right) {
    const c   = this.nikoConst
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

    const hud = document.createElement('div')
    Object.assign(hud.style, {
      position: 'fixed', top: '12px', right: '12px',
      background: 'rgba(0,0,0,0.78)', color: '#eee',
      padding: '10px 14px', fontFamily: 'monospace', fontSize: '12px',
      lineHeight: '1.65', borderRadius: '5px', border: '1px solid #555',
      zIndex: '600', pointerEvents: 'none', whiteSpace: 'pre',
    })
    document.body.appendChild(hud)

    this._pathVis = { dots, line, liveDot, hud }
    window.__niko = this.nikoConst
    console.log('[NikoPathVis] on — tweak via window.__niko')
  }

  _updatePathVis() {
    if (!this._pathVis || !this._camera) return

    const yaw   = this._facing
    const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const right = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw))
    const positions = this._pathVis.line.geometry.attributes.position.array

    for (let i = 0; i < PATH_DOT_COUNT; i++) {
      const pos = this._nikoPathPoint(i / (PATH_DOT_COUNT - 1), fwd, right)
      this._pathVis.dots[i].position.copy(pos)
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z
    }
    this._pathVis.line.geometry.attributes.position.needsUpdate = true
    this._pathVis.liveDot.position.copy(this._nikoPathPoint(this._nikoLerpT, fwd, right))

    const c = this.nikoConst
    const s = this.nikoState === 'hugging' ? '●hug' : '○held'
    this._pathVis.hud.textContent = [
      `── Niko Path  [P to hide] ──`,
      ``,
      `          HELD      HUG`,
      `fwd    ${c.fwdHeld.toFixed(3).padStart(8)}  ${c.fwdHug.toFixed(3)}`,
      `right  ${c.rightHeld.toFixed(3).padStart(8)}  ${c.rightHug.toFixed(3)}`,
      `up     ${c.upHeld.toFixed(3).padStart(8)}  ${c.upHug.toFixed(3)}`,
      ``,
      `arc control (midpoint offset)`,
      `ctrlRight  ${c.ctrlRight.toFixed(3)}`,
      `ctrlDown   ${c.ctrlDown.toFixed(3)}`,
      `lerpSpeed  ${c.lerpSpeed.toFixed(2)}`,
      ``,
      `t = ${this._nikoLerpT.toFixed(2)}  state = ${s}`,
      ``,
      `● green = held  ● red = hug`,
      `● cyan  = current`,
      ``,
      `console: window.__niko.ctrlRight = 0.3`,
    ].join('\n')
  }

  _destroyPathVis() {
    if (!this._pathVis) return
    const scene = this._gsm.scene
    for (const d of this._pathVis.dots) scene.remove(d)
    scene.remove(this._pathVis.line)
    scene.remove(this._pathVis.liveDot)
    this._pathVis.hud.remove()
    this._pathVis = null
    delete window.__niko
    console.log('[NikoPathVis] off')
  }

  // ─── Player body debug ───────────────────────────────────────────────────────

  _updatePlayerBody() {
    if (!this._playerBody) return
    const show  = this._showBodies
    const h     = this._currentBodyHeight
    const feetY = this.playerPosition.y - h
    const ys    = [feetY + BODY_RADIUS, feetY + h * 0.5, feetY + h - BODY_RADIUS]
    for (let i = 0; i < 3; i++) {
      this._playerBody[i].visible = show
      if (show) this._playerBody[i].position.set(this.playerPosition.x, ys[i], this.playerPosition.z)
    }
    if (this._cameraHelper) {
      this._cameraHelper.visible = show
      if (show) this._cameraHelper.update()
    }
  }

  _initPlayerBody() {
    if (this._playerBody) return
    const geo = new THREE.SphereGeometry(BODY_RADIUS, 12, 8)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.5, depthWrite: false
    })
    this._playerBody = [
      new THREE.Mesh(geo, mat),
      new THREE.Mesh(geo, mat),
      new THREE.Mesh(geo, mat),
    ]
    for (const s of this._playerBody) {
      s.visible = false
      this._gsm.scene.add(s)
    }
    this._cameraHelper = new THREE.CameraHelper(this._camera)
    this._cameraHelper.visible = false
    this._gsm.scene.add(this._cameraHelper)
  }
}
