// PathRecorder — in-game path authoring tool.
// Activated via the Settings Panel (Editing Tools > path recorder).
//
// [Click]               stamp a waypoint at current camera position (nothing hovered)
// [Hold on node/handle] grab and drag on an auto-selected plane while held
// [Backspace]           remove the last waypoint
// [Enter]               preview the path
// [Ctrl+Z]              undo   [Ctrl+Y / Ctrl+Shift+Z] redo
//
// Plane is chosen from camera facing direction (dominant axis):
//   mostly up/down  → XZ horizontal   mostly E/W → YZ vertical   mostly N/S → XY vertical
// Release mouse to drop. Esc cancels drag and restores position.
// Dragging a waypoint sphere moves its handles with it.
//
// Every drop/stamp/delete auto-saves to data/paths/{name}.json.

import * as THREE from 'three'
import { CutscenePlayer } from './CutscenePlayer.js'

const SEG_DURATION = 3

const COLOR_WP       = 0xff69b4
const COLOR_HANDLE   = 0xffb3d9
const COLOR_HOVERED  = 0xffffff
const COLOR_GRABBED  = 0xffff88
const COLOR_SPLINE   = 0xff2222   // red — player movement path
const COLOR_LOOK     = 0x3399ff   // blue — camera look direction
const COLOR_ARM      = 0xff69b4

// Plane indicator colors — one per world axis normal
const COLOR_PLANE_XZ = 0x4488ff   // horizontal  (normal Y)
const COLOR_PLANE_YZ = 0xff4444   // E/W vertical (normal X)
const COLOR_PLANE_XY = 0x44ff88   // N/S vertical (normal Z)

const PLANE_SIZE    = 1.5
const PLANE_OPACITY = 0.22

const WP_RADIUS     = 0.25
const HANDLE_RADIUS = 0.15
const TUBE_RADIUS   = 0.045
const TUBE_RADSEGS  = 7

const MAX_HISTORY = 50

export class PathRecorder {
  constructor(name, scene, gsm) {
    this._name       = name
    this._scene      = scene
    this._gsm        = gsm
    this._waypoints  = []
    this._active         = false
    this._previewing     = false
    this._overlayVisible = false

    this._player     = new CutscenePlayer()

    this._grabbed    = null   // { type: 'wp'|'hin'|'hout', idx } | null
    this._hovered    = null
    this._grabPlane  = null   // { origin: Vector3, normal: Vector3 }
    this._grabOffset = null   // Vector3 — node pos minus hit point at grab start

    this._history    = []
    this._future     = []

    this._wpMeshes   = []
    this._hinMeshes  = []
    this._houtMeshes = []
    this._armLines   = []
    this._lookLines  = []
    this._splineTube = null

    this._raycaster  = new THREE.Raycaster()
    this._planeMesh  = this._makePlaneMesh()
    this._hitDot    = null   // red sphere at raycasted scene surface
    this._crosshair = null   // Three.js plane mesh parented to camera

    this._onKeyDown   = e => this._handleKey(e)
    this._onMouseDown = e => this._handleMouseDown(e)
    this._onMouseUp   = e => this._handleMouseUp(e)
    window.addEventListener('keydown',   this._onKeyDown)
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup',   this._onMouseUp)
  }

  // Seed with existing waypoints loaded from disk (called once at startup).
  setWaypoints(waypoints) {
    this._waypoints = waypoints.map(w => this._normalizeWp(w))
    this._player.setPath(this._waypoints)
    if (this._overlayVisible && !this._active) this._rebuildSplineTube()
  }

  toggle() {
    this._active ? this._deactivate() : this._activate()
  }

  setActive(v) {
    if (v !== this._active) this.toggle()
  }

  setOverlayVisible(v) {
    this._overlayVisible = v
    if (this._active) return
    if (v) {
      this._rebuildSplineTube()
    } else if (this._splineTube) {
      this._scene.remove(this._splineTube)
      this._splineTube.geometry.dispose()
      this._splineTube.material.dispose()
      this._splineTube = null
    }
  }

  get isActive()         { return this._active }
  get isPreviewPlaying() { return this._previewing }
  get name()             { return this._name }

  preview() {
    this._preview()
  }

  stopPreview() {
    if (!this._previewing) return
    this._player._active = false
    this._previewing = false
    this.onPreviewEnd?.()
  }

  async loadPath(name) {
    this._autoSave()
    this._name      = name
    this._waypoints = []
    this._history   = []
    this._future    = []
    this._player.setPath([])
    if (this._active) this._fullRebuild()
    else if (this._overlayVisible) this._rebuildSplineTube()

    try {
      const res = await fetch(`/data/paths/${name}.json`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.waypoints) && data.waypoints.length > 0) {
          this._waypoints = data.waypoints.map(w => this._normalizeWp(w))
          this._player.setPath(this._waypoints)
          if (this._active) this._fullRebuild()
          else if (this._overlayVisible) this._rebuildSplineTube()
        }
      }
    } catch {}
  }

  tick(delta) {
    if (this._previewing) {
      this._player.tick(delta)
      if (!this._player.isPlaying) this._previewing = false
      return
    }

    if (!this._active) return

    if (this._grabbed) {
      this._tickGrab()
      return
    }

    if (document.pointerLockElement) {
      this._updateHover()
      if (this._hovered) {
        const mesh = this._getMeshForItem(this._hovered)
        if (mesh) this._updatePlaneVis(mesh.position, this._computeGrabPlane(mesh.position).normal)
      } else {
        this._planeMesh.visible = false
      }
    } else {
      this._planeMesh.visible = false
      if (this._hitDot) this._hitDot.visible = false
    }
  }

  dispose() {
    window.removeEventListener('keydown',   this._onKeyDown)
    window.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mouseup',   this._onMouseUp)
    this._deactivate()
  }

  // ─── Private — activation ─────────────────────────────────────────────────

  _activate() {
    this._active = true
    this._scene.add(this._planeMesh)
    this._planeMesh.visible = false

    this._hitDot = this._makeSphere(0.04, 0xff2222)
    this._hitDot.renderOrder = 1000
    this._hitDot.visible = false
    this._scene.add(this._hitDot)

    this._buildCrosshair()
    this._gsm.camera.add(this._crosshair)
    this._fullRebuild()
  }

  _deactivate() {
    this._active     = false
    this._previewing = false
    this._hovered    = null
    this._grabbed    = null
    this._grabPlane  = null
    this._grabOffset = null
    this._planeMesh.visible = false
    this._scene.remove(this._planeMesh)

    if (this._hitDot) {
      this._scene.remove(this._hitDot)
      this._hitDot.geometry.dispose()
      this._hitDot.material.dispose()
      this._hitDot = null
    }
    if (this._crosshair) {
      this._gsm.camera.remove(this._crosshair)
      this._crosshair.geometry.dispose()
      this._crosshair.material.dispose()
      this._crosshair = null
    }

    this._clearMeshes()
    if (this._overlayVisible) this._rebuildSplineTube()
  }

  // ─── Private — input ─────────────────────────────────────────────────────

  _handleKey(e) {
    if (!this._active || this._previewing) return

    // Escape cancels an in-progress grab and restores the pre-drag position
    if (e.code === 'Escape' && this._grabbed) {
      this._grabbed    = null
      this._grabPlane  = null
      this._grabOffset = null
      this._undo()
      return
    }

    if (this._grabbed) return

    if (e.ctrlKey && e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault(); this._undo(); return
    }
    if (e.ctrlKey && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
      e.preventDefault(); this._redo(); return
    }

    if (e.code === 'Backspace') {
      e.preventDefault()
      this._pushHistory()
      this._removeWaypoint(this._hovered ? this._hovered.idx : this._waypoints.length - 1)
      return
    }
    if (e.code === 'Enter') {
      e.preventDefault()
      this._preview()
      return
    }
  }

  _handleMouseDown(e) {
    if (!this._active) return
    if (!document.pointerLockElement) return
    if (e.button !== 0) return
    if (this._grabbed) return

    if (this._hovered) {
      const mesh = this._getMeshForItem(this._hovered)
      if (!mesh) return

      this._pushHistory()

      const nodePos = mesh.position.clone()
      const plane   = this._computeGrabPlane(nodePos)
      const hit     = this._rayPlaneIntersect(plane)

      this._grabbed    = { ...this._hovered }
      this._grabPlane  = plane
      this._grabOffset = hit ? nodePos.clone().sub(hit) : new THREE.Vector3()
      this._refreshColors()
    } else {
      this._pushHistory()
      this._stampWaypoint()
    }
  }

  _handleMouseUp(e) {
    if (!this._active) return
    if (e.button !== 0) return
    if (!this._grabbed) return

    this._grabbed    = null
    this._grabPlane  = null
    this._grabOffset = null
    this._planeMesh.visible = false
    this._player.setPath(this._waypoints)
    this._autoSave()
    this._refreshColors()
  }

  // ─── Private — grab plane ─────────────────────────────────────────────────

  _computeGrabPlane(origin) {
    const fwd = new THREE.Vector3()
    this._gsm.camera.getWorldDirection(fwd)
    const ax = Math.abs(fwd.x), ay = Math.abs(fwd.y), az = Math.abs(fwd.z)
    let normal
    if (ay >= ax && ay >= az)  normal = new THREE.Vector3(0, 1, 0)  // looking up/down → XZ
    else if (ax >= az)         normal = new THREE.Vector3(1, 0, 0)  // facing E/W    → YZ
    else                       normal = new THREE.Vector3(0, 0, 1)  // facing N/S    → XY
    return { origin: origin.clone(), normal }
  }

  _rayPlaneIntersect(plane) {
    const cam = this._gsm.camera
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize()
    const ray = new THREE.Ray(cam.position.clone(), dir)
    const pl  = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.origin)
    const tgt = new THREE.Vector3()
    return ray.intersectPlane(pl, tgt) ? tgt.clone() : null
  }

  _tickGrab() {
    // Keep plane vis centred on the node as it moves
    const mesh = this._getMeshForItem(this._grabbed)
    if (mesh) this._updatePlaneVis(mesh.position, this._grabPlane.normal)

    const hit = this._rayPlaneIntersect(this._grabPlane)
    if (!hit) return

    const newPos = hit.clone().add(this._grabOffset)
    const { type, idx } = this._grabbed
    const wp = this._waypoints[idx]
    if (!wp) return

    if (type === 'wp') {
      const dx = newPos.x - wp.x, dy = newPos.y - wp.y, dz = newPos.z - wp.z
      wp.x = newPos.x; wp.y = newPos.y; wp.z = newPos.z
      wp.handleIn.x  += dx; wp.handleIn.y  += dy; wp.handleIn.z  += dz
      wp.handleOut.x += dx; wp.handleOut.y += dy; wp.handleOut.z += dz
      this._wpMeshes[idx].position.copy(newPos)
      this._hinMeshes[idx].position.set(wp.handleIn.x,  wp.handleIn.y,  wp.handleIn.z)
      this._houtMeshes[idx].position.set(wp.handleOut.x, wp.handleOut.y, wp.handleOut.z)
    } else if (type === 'hin') {
      wp.handleIn.x = newPos.x; wp.handleIn.y = newPos.y; wp.handleIn.z = newPos.z
      this._hinMeshes[idx].position.copy(newPos)
    } else {
      wp.handleOut.x = newPos.x; wp.handleOut.y = newPos.y; wp.handleOut.z = newPos.z
      this._houtMeshes[idx].position.copy(newPos)
    }

    this._updateArmLine(idx)
    this._rebuildSplineTube()
  }

  // ─── Private — undo / redo ────────────────────────────────────────────────

  _snapshot() {
    return this._waypoints.map(w => ({
      ...w,
      handleIn:  { ...w.handleIn },
      handleOut: { ...w.handleOut },
    }))
  }

  _pushHistory() {
    this._history.push(this._snapshot())
    if (this._history.length > MAX_HISTORY) this._history.shift()
    this._future = []
  }

  _undo() {
    if (this._history.length === 0) return
    this._future.push(this._snapshot())
    this._waypoints = this._history.pop()
    this._player.setPath(this._waypoints)
    this._fullRebuild()
    this._autoSave()
  }

  _redo() {
    if (this._future.length === 0) return
    this._history.push(this._snapshot())
    this._waypoints = this._future.pop()
    this._player.setPath(this._waypoints)
    this._fullRebuild()
    this._autoSave()
  }

  // ─── Private — waypoints ─────────────────────────────────────────────────

  _stampWaypoint() {
    const cam   = this._gsm.camera
    const prevT = this._waypoints.length > 0
      ? this._waypoints[this._waypoints.length - 1].time
      : 0

    const fwd = new THREE.Vector3()
    cam.getWorldDirection(fwd)
    const hd = 1.5

    const wp = {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
      yaw:   cam.rotation.y,
      pitch: cam.rotation.x,
      time:  this._waypoints.length === 0 ? 0 : prevT + SEG_DURATION,
      handleIn: {
        x: cam.position.x - fwd.x * hd,
        y: cam.position.y - fwd.y * hd,
        z: cam.position.z - fwd.z * hd,
      },
      handleOut: {
        x: cam.position.x + fwd.x * hd,
        y: cam.position.y + fwd.y * hd,
        z: cam.position.z + fwd.z * hd,
      },
    }

    this._waypoints.push(wp)
    this._onChange()
    console.log(`[PathRecorder] stamped wp ${this._waypoints.length} at`, wp)
  }

  _removeWaypoint(idx) {
    if (this._waypoints.length === 0 || idx < 0 || idx >= this._waypoints.length) return
    this._waypoints.splice(idx, 1)
    this._onChange()
  }

  _preview() {
    if (this._waypoints.length < 2) return
    this._previewing = true
    this._player.play(this._gsm.camera, () => { this._previewing = false; this.onPreviewEnd?.() })
  }

  _onChange() {
    this._player.setPath(this._waypoints)
    this._fullRebuild()
    this._autoSave()
  }

  _autoSave() {
    if (this._waypoints.length === 0) return
    fetch('/dev/save-path', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: this._name, waypoints: this._waypoints }),
    }).catch(err => console.warn('[PathRecorder] auto-save failed:', err))
  }

  // ─── Private — mesh lookup ───────────────────────────────────────────────

  _getMeshForItem(item) {
    if (!item) return null
    if (item.type === 'wp')   return this._wpMeshes[item.idx]   ?? null
    if (item.type === 'hin')  return this._hinMeshes[item.idx]  ?? null
    if (item.type === 'hout') return this._houtMeshes[item.idx] ?? null
    return null
  }

  // ─── Private — hover ─────────────────────────────────────────────────────

  _updateHover() {
    this._raycaster.setFromCamera(new THREE.Vector2(0, 0), this._gsm.camera)

    const allItems = [
      ...this._wpMeshes.map((m, i)   => ({ mesh: m, type: 'wp',   idx: i })),
      ...this._hinMeshes.map((m, i)  => ({ mesh: m, type: 'hin',  idx: i })),
      ...this._houtMeshes.map((m, i) => ({ mesh: m, type: 'hout', idx: i })),
    ]

    const hits = this._raycaster.intersectObjects(allItems.map(a => a.mesh), false)
    const prev = JSON.stringify(this._hovered)

    if (hits.length > 0) {
      const found = allItems.find(a => a.mesh === hits[0].object)
      this._hovered = found ? { type: found.type, idx: found.idx } : null
      if (this._hitDot) { this._hitDot.position.copy(hits[0].point); this._hitDot.visible = true }
    } else {
      this._hovered = null
      if (this._hitDot) this._hitDot.visible = false
    }

    if (JSON.stringify(this._hovered) !== prev) this._refreshColors()
  }

  // ─── Private — visuals (full rebuild) ────────────────────────────────────

  _fullRebuild() {
    this._grabbed    = null
    this._grabPlane  = null
    this._grabOffset = null
    this._clearMeshes()
    const wps = this._waypoints
    if (wps.length === 0) return

    for (let i = 0; i < wps.length; i++) {
      const wp   = wps[i]
      const pos  = new THREE.Vector3(wp.x, wp.y, wp.z)
      const hin  = new THREE.Vector3(wp.handleIn.x,  wp.handleIn.y,  wp.handleIn.z)
      const hout = new THREE.Vector3(wp.handleOut.x, wp.handleOut.y, wp.handleOut.z)

      const wpM = this._makeSphere(WP_RADIUS, COLOR_WP)
      wpM.position.copy(pos)
      this._scene.add(wpM)
      this._wpMeshes.push(wpM)

      const hinM = this._makeSphere(HANDLE_RADIUS, COLOR_HANDLE)
      hinM.position.copy(hin)
      this._scene.add(hinM)
      this._hinMeshes.push(hinM)

      const houtM = this._makeSphere(HANDLE_RADIUS, COLOR_HANDLE)
      houtM.position.copy(hout)
      this._scene.add(houtM)
      this._houtMeshes.push(houtM)

      const pts = [hin, pos, hout]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: COLOR_ARM, depthTest: false })
      const arm = new THREE.Line(geo, mat)
      arm.renderOrder = 997
      this._scene.add(arm)
      this._armLines.push(arm)
    }

    this._rebuildSplineTube()
    this._refreshColors()
  }

  _updateArmLine(i) {
    const wp  = this._waypoints[i]
    const arm = this._armLines[i]
    if (!arm) return
    const attr = arm.geometry.attributes.position
    attr.setXYZ(0, wp.handleIn.x,  wp.handleIn.y,  wp.handleIn.z)
    attr.setXYZ(1, wp.x, wp.y, wp.z)
    attr.setXYZ(2, wp.handleOut.x, wp.handleOut.y, wp.handleOut.z)
    attr.needsUpdate = true
  }

  _rebuildSplineTube() {
    const wps = this._waypoints
    if (wps.length < 2) {
      if (this._splineTube) this._splineTube.visible = false
      this._rebuildLookLines()
      return
    }

    const curvePath = new THREE.CurvePath()
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1]
      curvePath.add(new THREE.CubicBezierCurve3(
        new THREE.Vector3(a.x,           a.y,           a.z),
        new THREE.Vector3(a.handleOut.x, a.handleOut.y, a.handleOut.z),
        new THREE.Vector3(b.handleIn.x,  b.handleIn.y,  b.handleIn.z),
        new THREE.Vector3(b.x,           b.y,           b.z),
      ))
    }

    const geo = new THREE.TubeGeometry(curvePath, wps.length * 24, TUBE_RADIUS, TUBE_RADSEGS, false)

    if (!this._splineTube) {
      const mat = new THREE.MeshBasicMaterial({ color: COLOR_SPLINE, depthTest: false })
      this._splineTube = new THREE.Mesh(geo, mat)
      this._splineTube.renderOrder = 996
      this._scene.add(this._splineTube)
    } else {
      this._splineTube.geometry.dispose()
      this._splineTube.geometry = geo
      this._splineTube.visible  = true
    }

    this._rebuildLookLines()
  }

  _refreshColors() {
    for (let i = 0; i < this._wpMeshes.length; i++) {
      this._wpMeshes[i].material.color.setHex(
        this._grabbed?.type === 'wp'   && this._grabbed.idx === i ? COLOR_GRABBED :
        this._hovered?.type === 'wp'   && this._hovered.idx === i ? COLOR_HOVERED : COLOR_WP
      )
      this._hinMeshes[i].material.color.setHex(
        this._grabbed?.type === 'hin'  && this._grabbed.idx === i ? COLOR_GRABBED :
        this._hovered?.type === 'hin'  && this._hovered.idx === i ? COLOR_HOVERED : COLOR_HANDLE
      )
      this._houtMeshes[i].material.color.setHex(
        this._grabbed?.type === 'hout' && this._grabbed.idx === i ? COLOR_GRABBED :
        this._hovered?.type === 'hout' && this._hovered.idx === i ? COLOR_HOVERED : COLOR_HANDLE
      )
    }
  }

  _makePlaneMesh() {
    const geo  = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)
    const mat  = new THREE.MeshBasicMaterial({
      color:       COLOR_PLANE_XZ,
      transparent: true,
      opacity:     PLANE_OPACITY,
      side:        THREE.DoubleSide,
      depthTest:   false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 998
    mesh.visible = false
    return mesh
  }

  _updatePlaneVis(origin, normal) {
    const color = normal.y > 0.9 ? COLOR_PLANE_XZ
                : normal.x > 0.9 ? COLOR_PLANE_YZ
                :                  COLOR_PLANE_XY
    this._planeMesh.material.color.setHex(color)
    this._planeMesh.position.copy(origin)
    this._planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    this._planeMesh.visible = true
  }

  _rebuildLookLines() {
    const drop = obj => { this._scene.remove(obj); obj.geometry.dispose(); obj.material.dispose() }
    for (const l of this._lookLines) drop(l)
    this._lookLines = []

    const LOOK_LEN = 0.7
    for (const wp of this._waypoints) {
      const origin = new THREE.Vector3(wp.x, wp.y, wp.z)
      const dir    = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(wp.pitch ?? 0, wp.yaw ?? 0, 0, 'YXZ'))
      const tip = origin.clone().addScaledVector(dir, LOOK_LEN)

      const geo = new THREE.BufferGeometry().setFromPoints([origin, tip])
      const mat = new THREE.LineBasicMaterial({ color: COLOR_LOOK, depthTest: false })
      const line = new THREE.Line(geo, mat)
      line.renderOrder = 997
      this._scene.add(line)
      this._lookLines.push(line)
    }
  }

  _clearMeshes() {
    const drop = obj => {
      this._scene.remove(obj)
      obj.geometry.dispose()
      obj.material.dispose()
    }
    for (const m of this._wpMeshes)   drop(m)
    for (const m of this._hinMeshes)  drop(m)
    for (const m of this._houtMeshes) drop(m)
    for (const l of this._armLines)   drop(l)
    for (const l of this._lookLines)  drop(l)
    if (this._splineTube) { drop(this._splineTube); this._splineTube = null }

    this._wpMeshes   = []
    this._hinMeshes  = []
    this._houtMeshes = []
    this._armLines   = []
    this._lookLines  = []
    this._hovered    = null
  }

  _makeSphere(radius, color) {
    const geo  = new THREE.SphereGeometry(radius, 10, 10)
    const mat  = new THREE.MeshBasicMaterial({ color, depthTest: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 999
    return mesh
  }

  _buildCrosshair() {
    const c   = document.createElement('canvas')
    c.width   = 64
    c.height  = 64
    const ctx = c.getContext('2d')
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(32, 14); ctx.lineTo(32, 26)
    ctx.moveTo(32, 38); ctx.lineTo(32, 50)
    ctx.moveTo(14, 32); ctx.lineTo(26, 32)
    ctx.moveTo(38, 32); ctx.lineTo(50, 32)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.arc(32, 32, 2, 0, Math.PI * 2)
    ctx.fill()

    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthTest:   false,
      depthWrite:  false,
    })
    const geo = new THREE.PlaneGeometry(0.05, 0.05)
    this._crosshair = new THREE.Mesh(geo, mat)
    this._crosshair.position.set(0, 0, -1)
    this._crosshair.renderOrder = 9999
  }

  _normalizeWp(w) {
    return {
      ...w,
      handleIn:  w.handleIn  ?? { x: w.x, y: w.y, z: w.z },
      handleOut: w.handleOut ?? { x: w.x, y: w.y, z: w.z },
    }
  }
}
