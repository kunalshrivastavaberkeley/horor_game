// src/systems/CameraController.js
// One logical camera: single PerspectiveCamera (_sharedCam) + one OrthographicCamera (_ortho).
// Control schemes: 'firstPerson' (free look, body-anchored), 'fly' (free movement, body-detached),
// 'orbit' (custom spherical orbit around a focus point — no Three.js controls classes).
// 'fly' is not exposed in the settings dropdown; it is activated only by the Fly/Spirit presets.

import * as THREE from 'three'
import { DEATH_Y } from './PlayerController.js'

const MOUSE_SENSITIVITY  = 0.002
const STROKE_GAP_MS      = 50
const PITCH_NEUTRAL      = -0.10
const PITCH_DRIFT_SPEED  = 0.35
const MOUSE_IDLE_MS      = 80
const BOB_PITCH_AMP      = 0.0011
const BOB_SPEED_SCALE    = 2.5
const MOVE_SPEED         = 5.0
const FLY_SPEED          = 20
const ORBIT_ROTATE_SPEED = 0.005
const ORBIT_PAN_SPEED    = 0.001
const ORBIT_ZOOM_FACTOR  = 0.001

export class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} sharedCamera - gsm.camera, the single perspective camera
   * @param {import('./PlayerController.js').PlayerController} player
   * @param {object} settings - GameSettings
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   */
  constructor(sharedCamera, player, settings, renderer, scene) {
    this._sharedCam = sharedCamera
    this._player    = player
    this._settings  = settings
    this._renderer  = renderer
    this._scene     = scene

    // Single orthographic mirror — synced to _sharedCam each frame when active
    this._projection = 'perspective'
    this._ortho      = this._makeOrtho()

    // ── First-person state ────────────────────────────────────────────────────
    this._fp = {
      yaw: 0, pitch: 0,
      strokeYaw: 0, strokePitch: 0,
      accumDx: 0, accumDy: 0, lastMoveMs: 0,
      keys: {},
      bobPhase: 0, normSpeed: 0,
      swayT: 0, smoothDir: new THREE.Vector3(),
      slugMultiplier: 1.0,
      swayAmount: 0,
      inputDriftSpeed: 10,
    }

    // ── Fly state ─────────────────────────────────────────────────────────────
    this._fly = { yaw: 0, pitch: 0, keys: {} }

    // ── Orbit state (custom spherical orbit) ──────────────────────────────────
    this._orb = {
      theta:  0,
      phi:    Math.PI / 3,
      radius: 20,
      drag:   false,
      pan:    false,
      lastX:  0,
      lastY:  0,
    }

    // ── Focus / examine ───────────────────────────────────────────────────────
    this._exam = {
      focusPoint: new THREE.Vector3(),
      focusLabel: 'none',
    }

    // ── Focusable providers ───────────────────────────────────────────────────
    this._focusableProviders = []

    // ── Shared ────────────────────────────────────────────────────────────────
    this._pointerLocked = false
    this._activeType    = null

    // ── Kill plane ────────────────────────────────────────────────────────────
    this._killPlane = this._buildKillPlane()
    scene.add(this._killPlane)

    // ── Coords HUD ────────────────────────────────────────────────────────────
    this._coordsEl = this._buildCoordsHUD()

    this._bindEvents()

    window.addEventListener('resize', () => {
      const aspect = window.innerWidth / window.innerHeight
      const s = 15
      this._ortho.left   = -s * aspect; this._ortho.right  = s * aspect
      this._ortho.top    =  s;          this._ortho.bottom = -s
      this._ortho.updateProjectionMatrix()
    })
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  get activeCamera() {
    return this._projection === 'ortho' ? this._ortho : this._sharedCam
  }

  get activeType() { return this._activeType }

  get cameraPosition() { return this._sharedCam.position.clone() }

  // IntroSequence API
  get slugMultiplier()        { return this._fp.slugMultiplier }
  set slugMultiplier(v)       { this._fp.slugMultiplier = v }
  get swayAmount()            { return this._fp.swayAmount }
  set swayAmount(v)           { this._fp.swayAmount = v }
  get inputDriftSpeed()       { return this._fp.inputDriftSpeed }
  set inputDriftSpeed(v)      { this._fp.inputDriftSpeed = v }
  get lookAngles()            { return { yaw: this._fp.yaw, pitch: this._fp.pitch } }

  setLookAngles(yaw, pitch) {
    this._fp.yaw         = yaw
    const clamp = this._settings.pitchLimit * (Math.PI / 180)
    this._fp.pitch       = Math.max(-clamp, Math.min(clamp, pitch))
    this._fp.strokeYaw   = this._fp.yaw
    this._fp.strokePitch = this._fp.pitch
    this._fp.accumDx     = 0
    this._fp.accumDy     = 0
  }

  registerFocusableProvider(system) {
    this._focusableProviders.push(system)
  }

  getAllFocusables() {
    return this._focusableProviders.flatMap(p => p.getFocusables())
  }

  setFocusPoint(position, label = '') {
    this._exam.focusPoint.copy(position)
    this._exam.focusLabel = label
    if (this._activeType === 'orbit') {
      const diff = this._sharedCam.position.clone().sub(position)
      const dist = diff.length()
      if (dist > 0.1) {
        this._orb.radius = dist
        this._orb.phi    = Math.acos(Math.max(-1, Math.min(1, diff.y / dist)))
        this._orb.theta  = Math.atan2(diff.x, diff.z)
      }
    }
  }

  get examFocusLabel() { return this._exam.focusLabel }

  setProjection(v) {
    this._projection = v
  }

  setType(newType) {
    if (newType === this._activeType) return
    this._deactivate(this._activeType)
    this._activeType = newType
    this._activate(newType)
  }

  update(delta) {
    this._killPlane.visible        = this._settings.killPlane
    this._coordsEl.style.display   = this._settings.coordsHUD ? 'block' : 'none'

    switch (this._activeType) {
      case 'firstPerson':
        this._updateFP(delta)
        if (this._projection === 'ortho') this._syncOrtho()
        break
      case 'fly':
        this._updateFly(delta)
        if (this._projection === 'ortho') this._syncOrtho()
        break
      case 'orbit':
        this._updateOrbit()
        if (this._projection === 'ortho') this._syncOrtho()
        break
    }
  }

  // ─── Activation / deactivation ────────────────────────────────────────────────

  _deactivate(type) {
    if (!type) return
    if (type === 'firstPerson') {
      document.exitPointerLock()
      this._player.releaseCamera()
      this._fp.keys = {}
    }
    if (type === 'fly') {
      document.exitPointerLock()
      this._fly.keys = {}
    }
    if (type === 'orbit') {
      this._orb.drag = false
      this._orb.pan  = false
    }
  }

  _activate(type) {
    if (type === 'firstPerson') {
      this._player.setCamera(this._sharedCam)
    }

    if (type === 'fly') {
      // Inherit orientation from firstPerson so the transition is seamless
      this._fly.yaw   = this._fp.yaw
      this._fly.pitch = this._fp.pitch
      // Spirit mode (lanternMesh visible): body stays frozen — don't re-attach camera to lantern.
      // Fly mode (lanternMesh hidden, collision off): re-attach so lantern tracks camera (irrelevant but harmless).
      if (!this._settings.collision && !this._settings.lanternMesh) {
        this._player.setLanternCamera(this._sharedCam)
      }
    }

    if (type === 'orbit') {
      const fp  = this._exam.focusPoint
      const cam = this._sharedCam.position

      if (cam.distanceTo(fp) < 2) {
        // No meaningful focus — project a point ahead of current camera
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this._sharedCam.quaternion)
        fwd.y = 0
        if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1)
        else fwd.normalize()
        fp.copy(cam).addScaledVector(fwd, 12)
      }

      const diff = cam.clone().sub(fp)
      const r    = Math.max(1, diff.length())
      this._orb.radius = r
      this._orb.phi    = Math.acos(Math.max(-1, Math.min(1, diff.y / r)))
      this._orb.theta  = Math.atan2(diff.x, diff.z)
    }
  }

  // ─── First-person update ──────────────────────────────────────────────────────

  _updateFP(delta) {
    const s  = this._fp
    const ts = this._player.timeScale

    const fwd   = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw))
    const right = new THREE.Vector3( Math.cos(s.yaw), 0, -Math.sin(s.yaw))
    const dir   = new THREE.Vector3()

    if (s.keys['KeyW'] || s.keys['ArrowUp'])    dir.addScaledVector(fwd,    1)
    if (s.keys['KeyS'] || s.keys['ArrowDown'])  dir.addScaledVector(fwd,   -1)
    if (s.keys['KeyA'] || s.keys['ArrowLeft'])  dir.addScaledVector(right, -1)
    if (s.keys['KeyD'] || s.keys['ArrowRight']) dir.addScaledVector(right,  1)
    if (dir.lengthSq() > 0) dir.normalize()

    if (dir.lengthSq() > 0) {
      s.smoothDir.lerp(dir, Math.min(1, s.inputDriftSpeed * delta))
    } else {
      s.smoothDir.set(0, 0, 0)
    }

    this._player.setFacing(s.yaw)
    this._player.move(s.smoothDir.clone().multiplyScalar(s.slugMultiplier), delta)

    const targetNorm = dir.lengthSq() > 0 ? 1 : 0
    s.normSpeed += (targetNorm - s.normSpeed) * Math.min(1, 6 * delta * ts)
    s.bobPhase  += s.normSpeed * MOVE_SPEED * BOB_SPEED_SCALE * delta * ts

    if (this._settings.pitchDrift && performance.now() - s.lastMoveMs > MOUSE_IDLE_MS) {
      s.pitch += (PITCH_NEUTRAL - s.pitch) * Math.min(1, PITCH_DRIFT_SPEED * delta * ts)
    }

    s.swayT += delta
    const swayYaw   = s.swayAmount * 0.028 * Math.sin(s.swayT * 0.65)
    const swayPitch = s.swayAmount * 0.018 * Math.sin(s.swayT * 1.05 + 1.3)

    if (!this._player.isCameraFrozen) {
      this._sharedCam.position.copy(this._player.playerPosition)
      this._sharedCam.rotation.order = 'YXZ'
      this._sharedCam.rotation.y     = s.yaw + swayYaw

      const bob = this._settings.headBob
        ? Math.sin(s.bobPhase) * BOB_PITCH_AMP * s.normSpeed
        : 0
      this._sharedCam.rotation.x = s.pitch + swayPitch + bob
    }

    this._updateCoordsFromPos(this._player.playerPosition)
  }

  // ─── Fly update ───────────────────────────────────────────────────────────────

  _updateFly(delta) {
    const s     = this._fly
    const speed = FLY_SPEED * delta

    this._sharedCam.rotation.order = 'YXZ'
    this._sharedCam.rotation.y     = s.yaw
    this._sharedCam.rotation.x     = s.pitch

    const fwd   = new THREE.Vector3(0, 0, -1).applyEuler(this._sharedCam.rotation)
    const right = new THREE.Vector3(1, 0,  0).applyEuler(this._sharedCam.rotation)
    fwd.y = 0; fwd.normalize()
    right.y = 0; right.normalize()

    if (s.keys['KeyW'])                               this._sharedCam.position.addScaledVector(fwd,    speed)
    if (s.keys['KeyS'])                               this._sharedCam.position.addScaledVector(fwd,   -speed)
    if (s.keys['KeyA'])                               this._sharedCam.position.addScaledVector(right, -speed)
    if (s.keys['KeyD'])                               this._sharedCam.position.addScaledVector(right,  speed)
    if (s.keys['Space'])                              this._sharedCam.position.y += speed
    if (s.keys['ShiftLeft'] || s.keys['ShiftRight'])  this._sharedCam.position.y -= speed

    // Fly mode: camera is the source of truth for player position (for flyReturn on exit).
    // Spirit mode: body stays frozen so spiritReturn snaps camera back to it.
    if (!this._settings.collision && !this._settings.lanternMesh) {
      this._player.playerPosition.copy(this._sharedCam.position)
    }

    this._updateCoordsFromPos(this._sharedCam.position)
  }

  // ─── Orbit update (custom spherical orbit) ────────────────────────────────────

  _updateOrbit() {
    const { theta, phi, radius } = this._orb
    const fp     = this._exam.focusPoint
    const sinPhi = Math.sin(phi)

    this._sharedCam.position.set(
      fp.x + radius * sinPhi * Math.sin(theta),
      fp.y + radius * Math.cos(phi),
      fp.z + radius * sinPhi * Math.cos(theta),
    )
    this._sharedCam.lookAt(fp)

    this._updateCoordsFromPos(this._sharedCam.position)
  }

  // ─── Input ────────────────────────────────────────────────────────────────────

  _bindEvents() {
    window.addEventListener('keydown', e => this._onKey(e))
    window.addEventListener('keyup',   e => this._onKeyUp(e))
    document.addEventListener('mousemove', e => this._onMouseMove(e))
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this._pointerLocked
      this._pointerLocked = document.pointerLockElement === this._renderer.domElement
      if (wasLocked && !this._pointerLocked && this._player.onPause) {
        this._player.onPause()
      }
    })
    this._renderer.domElement.addEventListener('click', e => this._onClick(e))

    // Orbit drag / pan / zoom
    this._renderer.domElement.addEventListener('mousedown', e => {
      if (this._activeType !== 'orbit') return
      if (e.button === 0) this._orb.drag = true
      if (e.button === 1 || e.button === 2) this._orb.pan = true
      this._orb.lastX = e.clientX
      this._orb.lastY = e.clientY
    })
    window.addEventListener('mouseup', () => {
      this._orb.drag = false
      this._orb.pan  = false
    })
    this._renderer.domElement.addEventListener('wheel', e => {
      if (this._activeType !== 'orbit') return
      this._orb.radius = Math.max(1, Math.min(500, this._orb.radius * (1 + e.deltaY * ORBIT_ZOOM_FACTOR)))
      e.preventDefault()
    }, { passive: false })
    this._renderer.domElement.addEventListener('contextmenu', e => {
      if (this._activeType === 'orbit') e.preventDefault()
    })
  }

  _onKey(e) {
    if (this._activeType === 'firstPerson') this._fp.keys[e.code]  = true
    if (this._activeType === 'fly')         this._fly.keys[e.code] = true
  }

  _onKeyUp(e) {
    if (this._activeType === 'firstPerson') {
      delete this._fp.keys[e.code]
      if (e.code === 'KeyE') this._player.interact()
    }
    if (this._activeType === 'fly') {
      delete this._fly.keys[e.code]
    }
  }

  _onMouseMove(e) {
    if (this._pointerLocked) {
      if (this._activeType === 'firstPerson') {
        if (this._player.isCameraFrozen) return
        const s   = this._fp
        const now = performance.now()
        if (now - s.lastMoveMs > STROKE_GAP_MS) {
          s.strokeYaw = s.yaw; s.strokePitch = s.pitch
          s.accumDx = 0; s.accumDy = 0
        }
        s.lastMoveMs = now
        s.accumDx += e.movementX
        s.accumDy += e.movementY
        s.yaw   = s.strokeYaw   - s.accumDx * MOUSE_SENSITIVITY
        s.pitch = s.strokePitch - s.accumDy * MOUSE_SENSITIVITY
        const clamp = this._settings.pitchLimit * (Math.PI / 180)
        s.pitch = Math.max(-clamp, Math.min(clamp, s.pitch))
      }

      if (this._activeType === 'fly') {
        this._fly.yaw   -= e.movementX * MOUSE_SENSITIVITY
        this._fly.pitch -= e.movementY * MOUSE_SENSITIVITY
        this._fly.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._fly.pitch))
      }
      return
    }

    // Non-pointer-lock: orbit rotate / pan
    if (this._activeType === 'orbit') {
      const dx = e.clientX - this._orb.lastX
      const dy = e.clientY - this._orb.lastY
      this._orb.lastX = e.clientX
      this._orb.lastY = e.clientY

      if (this._orb.drag) {
        this._orb.theta -= dx * ORBIT_ROTATE_SPEED
        this._orb.phi   -= dy * ORBIT_ROTATE_SPEED
        this._orb.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, this._orb.phi))
      }

      if (this._orb.pan) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this._sharedCam.quaternion)
        const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._sharedCam.quaternion)
        const speed = this._orb.radius * ORBIT_PAN_SPEED
        this._exam.focusPoint.addScaledVector(right, -dx * speed)
        this._exam.focusPoint.addScaledVector(up,     dy * speed)
      }
    }
  }

  _onClick(e) {
    if ((this._activeType === 'firstPerson' || this._activeType === 'fly') && !this._pointerLocked) {
      this._renderer.domElement.requestPointerLock()
      return
    }
    if (this._activeType === 'orbit') {
      this._tryFocusFromClick(e)
    }
  }

  _tryFocusFromClick(e) {
    const focusables = this.getAllFocusables()
    if (focusables.length === 0) return

    const rect  = this._renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(mouse, this._sharedCam)

    let best = null, bestDist = Infinity
    for (const f of focusables) {
      const d = ray.ray.distanceToPoint(f.position)
      if (d < bestDist && d < 2.0) { bestDist = d; best = f }
    }
    if (best) this.setFocusPoint(best.position, best.label)
  }

  // ─── Coords HUD ───────────────────────────────────────────────────────────────

  _buildCoordsHUD() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', bottom: '10px', left: '10px',
      color: '#0f0', fontFamily: 'monospace', fontSize: '13px',
      background: 'rgba(0,0,0,.6)', padding: '4px 8px',
      borderRadius: '4px', zIndex: '300', pointerEvents: 'none',
      display: 'none',
    })
    document.body.appendChild(el)
    return el
  }

  _updateCoordsFromPos(pos) {
    if (!this._settings.coordsHUD) return
    this._coordsEl.textContent = `X ${pos.x.toFixed(1)}  Y ${pos.y.toFixed(1)}  Z ${pos.z.toFixed(1)}`
  }

  // ─── Orthographic helper ──────────────────────────────────────────────────────

  _makeOrtho() {
    const aspect = window.innerWidth / window.innerHeight
    const s      = 15
    return new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, 0.1, 2000)
  }

  _syncOrtho() {
    this._ortho.position.copy(this._sharedCam.position)
    this._ortho.quaternion.copy(this._sharedCam.quaternion)
    this._ortho.updateMatrixWorld()
  }

  // ─── Kill plane ───────────────────────────────────────────────────────────────

  _buildKillPlane() {
    const group = new THREE.Group()
    group.position.y = DEATH_Y
    group.visible    = false

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshBasicMaterial({
        color: 0xff2200, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    plane.rotation.x  = -Math.PI / 2
    plane.renderOrder = 1
    group.add(plane)

    const grid = new THREE.GridHelper(600, 60, 0xff4400, 0xff4400)
    grid.material.opacity     = 0.45
    grid.material.transparent = true
    grid.renderOrder          = 2
    group.add(grid)

    return group
  }
}
