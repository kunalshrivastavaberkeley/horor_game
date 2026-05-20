// src/systems/modes/FlyMode.js
// Fly mode — free-fly perspective camera for dev out-of-game exploration.
// On enter: syncs to player position. On exit: teleports player to fly cam position.

import * as THREE from 'three'
import { DEATH_Y } from '../PlayerController.js'

const FLY_SPEED = 20  // units/second

export class FlyMode {
  constructor(renderer, entity, lighting, modeManager, scene) {
    this._renderer  = renderer
    this._entity    = entity
    this._lighting  = lighting
    this._mm        = modeManager
    this._scene     = scene ?? null

    this._yaw            = 0
    this._pitch          = 0
    this._keys           = {}
    this._pointerLocked  = false
    this._killPlaneOn    = true

    this._killPlane = this._buildKillPlane()
    if (this._scene) this._scene.add(this._killPlane)

    this.camera = new THREE.PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 2000
    )
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
    })
  }

  // ─── Mode interface ───────────────────────────────────────────────────────────

  get bindings() {
    return [
      ['WASD',          'move'],
      ['Space / Shift', 'up / down'],
      ['Mouse',         'look'],
      ['I',             'toggle lighting'],
      ['K',             'toggle kill-plane (fall death threshold)'],
    ]
  }

  onEnter(_prevCamera) {
    this.camera.position.copy(this._entity.playerPosition)
    this._yaw   = this._entity.getFacing?.() ?? 0
    this._pitch = 0

    this._killPlane.visible = this._killPlaneOn
    this._renderer.domElement.requestPointerLock()
    this._lighting.setDevLighting(true)
    this._entity.setBodyVisible(true)
  }

  onExit() {
    this._killPlane.visible = false
    this._entity.teleportTo(this.camera.position.x, this.camera.position.z)
    document.exitPointerLock()
    this._lighting.setDevLighting(false)
    this._entity.setBodyVisible(false)
    this._keys = {}
  }

  onKey(e) {
    if (e.key === 'k' || e.key === 'K') {
      this._killPlaneOn       = !this._killPlaneOn
      this._killPlane.visible = this._killPlaneOn
      console.log(`[FlyMode] kill plane ${this._killPlaneOn ? 'on' : 'off'}`)
      return
    }
    if (e.key === 'i' || e.key === 'I') {
      this._lighting.setDevLighting(!this._lighting._devLighting)
      return
    }
    this._keys[e.key] = true
  }

  onKeyUp(e) {
    delete this._keys[e.key]
  }

  onMouseMove(e) {
    if (!this._pointerLocked) return
    this._yaw   -= e.movementX * 0.002
    this._pitch -= e.movementY * 0.002
    this._pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._pitch))
  }

  onPointerLockChange(locked) {
    this._pointerLocked = locked
  }

  update(delta) {
    const speed = FLY_SPEED * delta
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y     = this._yaw
    this.camera.rotation.x     = this._pitch

    const fwd   = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation)
    const right = new THREE.Vector3(1, 0,  0).applyEuler(this.camera.rotation)
    fwd.y = 0; fwd.normalize()
    right.y = 0; right.normalize()

    if (this._keys['w'] || this._keys['W']) this.camera.position.addScaledVector(fwd,   speed)
    if (this._keys['s'] || this._keys['S']) this.camera.position.addScaledVector(fwd,  -speed)
    if (this._keys['a'] || this._keys['A']) this.camera.position.addScaledVector(right, -speed)
    if (this._keys['d'] || this._keys['D']) this.camera.position.addScaledVector(right,  speed)
    if (this._keys[' '])      this.camera.position.y += speed
    if (this._keys['Shift'])  this.camera.position.y -= speed

    const p = this.camera.position
    this._mm.setCoords(`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`)
  }

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
