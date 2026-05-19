// src/systems/MapEditor.js
// God-mode map editor using Three.js TransformControls + GridHelper.
// Toggle with E while god mode is active.

import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js'

const DEV_MODE    = true
const WALL_COLOR  = 0x00ff88
const PATH_COLOR  = 0xff6600
const SPAWN_DIST  = 6        // units in front of camera when spawning objects

export class MapEditor {
  constructor(scene, renderer, sceneManagement) {
    this.isActive  = false
    this.isDragging = false   // true while TransformControls is being dragged

    if (!DEV_MODE) {
      this.toggle        = () => {}
      this.update        = () => {}
      this.getCamera     = () => new THREE.PerspectiveCamera()
      this.syncCameraFrom= () => {}
      this.getWallMeshes = () => []
      this.getSnakePath  = () => []
      return
    }

    this._scene    = scene
    this._renderer = renderer
    this._sm       = sceneManagement

    this._walls    = []   // Array<{ id, mesh, data }>
    this._path     = []   // Array<{ mesh, pos: Vector3 }>
    this._pathLine = null
    this._selected = null
    this._nextId   = 0

    // ── Dedicated editor camera — completely separate from godCam ────────────
    // Parked far away when editor is inactive so it never interferes.
    this._cam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000)
    this._cam.position.set(0, 99999, 0)

    window.addEventListener('resize', () => {
      this._cam.aspect = window.innerWidth / window.innerHeight
      this._cam.updateProjectionMatrix()
    })

    // ── Grid ────────────────────────────────────────────────────────────────
    this._grid = new THREE.GridHelper(500, 100, 0x555555, 0x333333)
    this._grid.position.y = 0.02
    this._grid.visible    = false
    scene.add(this._grid)

    // ── OrbitControls — owns editorCam entirely ──────────────────────────────
    this._oc = new OrbitControls(this._cam, renderer.domElement)
    this._oc.enableDamping = true
    this._oc.dampingFactor = 0.1
    this._oc.enabled       = false

    // ── TransformControls ───────────────────────────────────────────────────
    this._tc = new TransformControls(this._cam, renderer.domElement)
    this._tc.setMode('translate')
    this._tc.visible = false
    scene.add(this._tc)

    // Standard Three.js pattern: disable orbit while dragging a gizmo
    this._tc.addEventListener('dragging-changed', evt => {
      this.isDragging  = evt.value
      this._oc.enabled = !evt.value
    })
    this._tc.addEventListener('objectChange', () => {
      this._syncSelectedData()
    })

    // ── Path visuals root (hidden outside editor) ───────────────────────────
    this._pathRoot = new THREE.Group()
    this._pathRoot.visible = false
    scene.add(this._pathRoot)

    // ── Raycaster for click-select ──────────────────────────────────────────
    this._raycaster = new THREE.Raycaster()

    this._buildUI()
    this._bindEvents()
    this.load()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public
  // ──────────────────────────────────────────────────────────────────────────

  toggle() { this.isActive ? this._deactivate() : this._activate() }

  /** Collision meshes for PlayerCollision (always present in scene). */
  getWallMeshes() { return this._walls.map(w => w.mesh) }

  /** Ordered patrol waypoints for EnemySystem. */
  getSnakePath() { return this._path.map(p => p.pos.clone()) }

  /** Returns the dedicated editor perspective camera for the GSM render loop. */
  getCamera() { return this._cam }

  update() {
    if (this.isActive) this._oc.update()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Activate / Deactivate
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Call from main.js before activating — copies godCam position/rotation into
   * the editor camera and sets the orbit target in front of it.
   */
  syncCameraFrom(sourceCam) {
    this._cam.position.copy(sourceCam.position)
    this._cam.rotation.copy(sourceCam.rotation)
    const dir = new THREE.Vector3()
    this._cam.getWorldDirection(dir)
    this._oc.target.copy(this._cam.position).addScaledVector(dir, 8)
    this._oc.update()
  }

  _activate() {
    this.isActive      = true
    this._oc.enabled   = true
    this._grid.visible     = true
    this._pathRoot.visible = true
    this._walls.forEach(w => { w.mesh.material.visible = true })
    this._panel.style.display = 'flex'
    this._renderer.domElement.style.cursor = 'default'
    document.exitPointerLock()
  }

  _deactivate() {
    this.isActive    = false
    this._oc.enabled = false
    // Park the camera out of sight until next activation
    this._cam.position.set(0, 99999, 0)
    this._grid.visible     = false
    this._pathRoot.visible = false
    this._walls.forEach(w => { w.mesh.material.visible = false })
    this._tc.detach()
    this._tc.visible = false
    this._selected   = null
    this._panel.style.display = 'none'
    this._renderer.domElement.style.cursor = ''
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UI panel
  // ──────────────────────────────────────────────────────────────────────────

  _buildUI() {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
      display: 'none', position: 'fixed', top: '10px', left: '10px',
      width: '170px', background: 'rgba(0,0,0,.88)',
      border: '1px solid #0f0', borderRadius: '6px',
      color: '#fff', fontFamily: 'monospace', fontSize: '12px',
      padding: '8px', flexDirection: 'column', gap: '6px',
      zIndex: '300', userSelect: 'none',
    })

    const title = document.createElement('div')
    title.textContent = 'MAP EDITOR'
    title.style.cssText = 'color:#0f0;font-weight:bold;text-align:center;border-bottom:1px solid #0f0;padding-bottom:4px;'
    panel.appendChild(title)

    // ── Spawn buttons ────────────────────────────────────────────────────────
    const spawnLabel = this._label('Add objects:')
    panel.appendChild(spawnLabel)

    const spawnRow = document.createElement('div')
    spawnRow.style.cssText = 'display:flex;gap:4px;'

    const addWallBtn = this._btn('+ Wall', '#0a3a1a', '1px solid #0f0', '#0f0')
    addWallBtn.title = 'Spawn a new wall in front of camera'
    addWallBtn.addEventListener('click', e => { e.stopPropagation(); this._spawnWall() })

    const addPathBtn = this._btn('+ Path pt', '#3a1a00', '1px solid #fa0', '#fa0')
    addPathBtn.title = 'Spawn a snake path waypoint in front of camera'
    addPathBtn.addEventListener('click', e => { e.stopPropagation(); this._spawnPathPoint() })

    spawnRow.appendChild(addWallBtn)
    spawnRow.appendChild(addPathBtn)
    panel.appendChild(spawnRow)

    // ── Transform mode ───────────────────────────────────────────────────────
    panel.appendChild(this._label('Transform mode:'))

    const modeRow = document.createElement('div')
    modeRow.style.cssText = 'display:flex;gap:4px;'

    this._modeBtns = {}
    ;[['translate','T'],['rotate','R'],['scale','S']].forEach(([mode, key]) => {
      const btn = this._btn(`[${key}] ${mode[0].toUpperCase()}${mode.slice(1)}`, '#111', '1px solid #555', '#aaa')
      btn.style.flex = '1'
      btn.addEventListener('click', e => { e.stopPropagation(); this._setTcMode(mode) })
      this._modeBtns[mode] = btn
      modeRow.appendChild(btn)
    })
    panel.appendChild(modeRow)
    this._highlightModeBtn('translate')

    // ── Actions ──────────────────────────────────────────────────────────────
    const actRow = document.createElement('div')
    actRow.style.cssText = 'display:flex;gap:4px;border-top:1px solid #333;padding-top:4px;'

    const saveBtn = this._btn('Save', '#114411', '1px solid #0f0', '#0f0')
    saveBtn.addEventListener('click', e => { e.stopPropagation(); this.save() })

    const delBtn = this._btn('Delete', '#441111', '1px solid #f44', '#f66')
    delBtn.title = 'Delete selected object (Del key)'
    delBtn.addEventListener('click', e => { e.stopPropagation(); this._deleteSelected() })

    const undoBtn = this._btn('Undo pt', '#222', '1px solid #888', '#888')
    undoBtn.title = 'Remove last path point (Backspace)'
    undoBtn.addEventListener('click', e => { e.stopPropagation(); this._removeLastPathPoint() })

    actRow.appendChild(saveBtn)
    actRow.appendChild(delBtn)
    actRow.appendChild(undoBtn)
    panel.appendChild(actRow)

    // ── Status / stats ───────────────────────────────────────────────────────
    this._statusEl = document.createElement('div')
    this._statusEl.style.cssText = 'color:#0f0;font-size:11px;min-height:14px;'
    panel.appendChild(this._statusEl)

    this._statsEl = document.createElement('div')
    this._statsEl.style.cssText = 'color:#555;font-size:10px;'
    panel.appendChild(this._statsEl)

    const hint = document.createElement('div')
    hint.style.cssText = 'color:#444;font-size:10px;line-height:1.5;border-top:1px solid #222;padding-top:4px;'
    hint.innerHTML = 'Click to select<br>T/R/S: transform mode<br>Del: delete | 1-4: switch mode'
    panel.appendChild(hint)

    document.body.appendChild(panel)
    this._panel = panel
    this._updateStats()
  }

  _label(text) {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = 'color:#666;font-size:10px;'
    return el
  }

  _btn(text, bg, border, color) {
    const b = document.createElement('button')
    b.textContent = text
    Object.assign(b.style, {
      flex: '1', background: bg, border, color, padding: '4px 3px',
      cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px',
      borderRadius: '3px', whiteSpace: 'nowrap',
    })
    return b
  }

  _setTcMode(mode) {
    this._tc.setMode(mode)
    this._highlightModeBtn(mode)
  }

  _highlightModeBtn(active) {
    Object.entries(this._modeBtns).forEach(([k, btn]) => {
      btn.style.background = k === active ? '#1a3a1a' : '#111'
      btn.style.color      = k === active ? '#0f0'    : '#aaa'
    })
  }

  _updateStats() {
    if (this._statsEl) {
      this._statsEl.textContent = `Walls: ${this._walls.length}  Path pts: ${this._path.length}`
    }
  }

  _setStatus(msg, duration = 2000) {
    this._statusEl.textContent = msg
    if (duration > 0) setTimeout(() => { this._statusEl.textContent = '' }, duration)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Events
  // ──────────────────────────────────────────────────────────────────────────

  _bindEvents() {
    const canvas = this._renderer.domElement

    this._cbClick = e => { if (this.isActive && !this.isDragging) this._onCanvasClick(e) }
    this._cbKey   = e => { if (this.isActive) this._onKey(e) }
    this._cbCtx   = e => { if (this.isActive) e.preventDefault() }

    canvas.addEventListener('click',       this._cbClick)
    canvas.addEventListener('contextmenu', this._cbCtx)
    window.addEventListener('keydown',     this._cbKey)
  }

  _onCanvasClick(e) {
    if (e.target !== this._renderer.domElement) return
    const ndc = this._ndc(e)
    this._raycaster.setFromCamera(ndc, this._cam)

    const targets = [...this._walls.map(w => w.mesh), ...this._path.map(p => p.mesh)]
    const hits    = this._raycaster.intersectObjects(targets, false)

    if (hits.length > 0) {
      this._select(hits[0].object)
    } else {
      this._deselect()
    }
  }

  _onKey(e) {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    switch (e.key) {
      case 'Delete':    this._deleteSelected();     break
      case 'Backspace': this._removeLastPathPoint(); e.preventDefault(); break
      case 't': case 'T': this._setTcMode('translate'); break
      case 'r': case 'R': this._setTcMode('rotate');    break
      case 's': case 'S': this._setTcMode('scale');     break
    }
  }

  _ndc(e) {
    const r = this._renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width)  *  2 - 1,
      ((e.clientY - r.top)  / r.height) * -2 + 1
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Spawn helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** World position SPAWN_DIST units in front of the god camera at Y≈floor. */
  _spawnPos() {
    const dir = new THREE.Vector3()
    this._cam.getWorldDirection(dir)
    dir.y = 0
    dir.normalize()
    const pos = this._cam.position.clone().addScaledVector(dir, SPAWN_DIST)
    // Try to snap to actual floor
    const rc = new THREE.Raycaster(
      new THREE.Vector3(pos.x, 50, pos.z),
      new THREE.Vector3(0, -1, 0)
    )
    const cata = this._sm.getCatacombMesh?.()
    if (cata) {
      const hits = rc.intersectObject(cata, true)
      if (hits.length > 0) pos.y = hits[0].point.y
    }
    return pos
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Wall
  // ──────────────────────────────────────────────────────────────────────────

  _spawnWall() {
    const pos  = this._spawnPos()
    const id   = `w_${this._nextId++}`
    const data = { id, x: pos.x, y: pos.y, z: pos.z, w: 1.0, h: 3.0, d: 0.2 }
    const mesh = this._buildWallMesh(data)
    this._scene.add(mesh)
    this._walls.push({ id, mesh, data })
    this._updateStats()
    this._select(mesh)
    this._notifyWallsChanged()
  }

  _buildWallMesh(data) {
    const geo  = new THREE.BoxGeometry(data.w, data.h, data.d)
    // material.visible = false keeps it hidden from the player camera but
    // mesh.visible = true means the raycaster still hits it.
    const mat  = new THREE.MeshBasicMaterial({
      color: WALL_COLOR, wireframe: false, transparent: true, opacity: 0.3,
    })
    mat.visible = this.isActive   // shown in editor, hidden in game
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(data.x, data.y + data.h / 2, data.z)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: WALL_COLOR })
    )
    mesh.add(edges)

    mesh.userData.editorType = 'wall'
    mesh.userData.editorId   = data.id
    return mesh
  }

  /** Called by TransformControls objectChange — keeps data in sync with mesh transform. */
  _syncSelectedData() {
    if (!this._selected) return
    const type = this._selected.userData.editorType
    if (type === 'wall') {
      const entry = this._walls.find(w => w.id === this._selected.userData.editorId)
      if (!entry) return
      entry.data.x = this._selected.position.x
      entry.data.y = this._selected.position.y - entry.data.h / 2
      entry.data.z = this._selected.position.z
      // If scale changed, update w/h/d
      entry.data.w = entry.data.w * this._selected.scale.x
      entry.data.h = entry.data.h * this._selected.scale.y
      entry.data.d = entry.data.d * this._selected.scale.z
      // Reset scale back to 1 and bake into geometry
      this._selected.scale.set(1, 1, 1)
      this._selected.geometry.dispose()
      this._selected.geometry = new THREE.BoxGeometry(entry.data.w, entry.data.h, entry.data.d)
      const edges = this._selected.children[0]
      if (edges) { edges.geometry.dispose(); edges.geometry = new THREE.EdgesGeometry(this._selected.geometry) }
    } else if (type === 'path') {
      const idx = this._selected.userData.editorIndex
      if (idx >= 0 && idx < this._path.length) {
        this._path[idx].pos.copy(this._selected.position)
        this._rebuildPathLine()
        this._notifyPathChanged()
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Path points
  // ──────────────────────────────────────────────────────────────────────────

  _spawnPathPoint() {
    const pos  = this._spawnPos()
    const geo  = new THREE.SphereGeometry(0.35, 8, 8)
    const mat  = new THREE.MeshBasicMaterial({ color: PATH_COLOR })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(pos)
    mesh.userData.editorType  = 'path'
    mesh.userData.editorIndex = this._path.length
    this._pathRoot.add(mesh)
    this._path.push({ mesh, pos: pos.clone() })
    this._rebuildPathLine()
    this._updateStats()
    this._select(mesh)
    this._notifyPathChanged()
  }

  _removeLastPathPoint() {
    if (this._path.length === 0) return
    const last = this._path.pop()
    if (this._selected === last.mesh) this._deselect()
    this._pathRoot.remove(last.mesh)
    last.mesh.geometry.dispose()
    last.mesh.material.dispose()
    this._rebuildPathLine()
    this._updateStats()
    this._notifyPathChanged()
  }

  _rebuildPathLine() {
    if (this._pathLine) {
      this._pathRoot.remove(this._pathLine)
      this._pathLine.geometry.dispose()
      this._pathLine = null
    }
    if (this._path.length < 2) return
    const pts = this._path.map(p => p.pos)
    this._pathLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]),
      new THREE.LineBasicMaterial({ color: PATH_COLOR })
    )
    this._pathRoot.add(this._pathLine)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Selection
  // ──────────────────────────────────────────────────────────────────────────

  _select(mesh) {
    this._deselect()
    this._selected = mesh
    this._tc.attach(mesh)
    this._tc.visible = true
    const t = mesh.userData.editorType
    const k = t === 'wall' ? mesh.userData.editorId : `path[${mesh.userData.editorIndex}]`
    this._setStatus(`Selected: ${k}`, 0)
  }

  _deselect() {
    this._selected = null
    this._tc.detach()
    this._tc.visible = false
    this._setStatus('', 0)
  }

  _deleteSelected() {
    if (!this._selected) return
    const type = this._selected.userData.editorType

    if (type === 'wall') {
      const id  = this._selected.userData.editorId
      const idx = this._walls.findIndex(w => w.id === id)
      if (idx !== -1) {
        this._scene.remove(this._walls[idx].mesh)
        this._walls[idx].mesh.geometry.dispose()
        this._walls.splice(idx, 1)
        this._notifyWallsChanged()
      }
    } else if (type === 'path') {
      const idx = this._selected.userData.editorIndex
      if (idx >= 0 && idx < this._path.length) {
        this._pathRoot.remove(this._path[idx].mesh)
        this._path[idx].mesh.geometry.dispose()
        this._path.splice(idx, 1)
        this._path.forEach((p, i) => { p.mesh.userData.editorIndex = i })
        this._rebuildPathLine()
        this._notifyPathChanged()
      }
    }
    this._deselect()
    this._updateStats()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Change callbacks
  // ──────────────────────────────────────────────────────────────────────────

  onWallsChanged = null
  onPathChanged  = null

  _notifyWallsChanged() { this.onWallsChanged?.() }
  _notifyPathChanged()  { this.onPathChanged?.()  }

  // ──────────────────────────────────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────────────────────────────────

  async save() {
    const payload = {
      walls:     this._walls.map(w => w.data),
      snakePath: this._path.map(p => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z })),
    }
    try {
      const res = await fetch('/dev/save-map', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload, null, 2),
      })
      this._setStatus(res.ok ? 'Saved ✓' : 'Save failed!')
    } catch (err) {
      this._setStatus('Save error!')
      console.error('[MapEditor] save:', err)
    }
  }

  async load() {
    try {
      const res = await fetch('/data/map_data.json')
      if (!res.ok) return
      const data = await res.json()
      this._loadWalls(data.walls    ?? [])
      this._loadPath (data.snakePath ?? [])
    } catch { /* no file yet */ }
  }

  _loadWalls(walls) {
    walls.forEach(d => {
      const id   = d.id ?? `w_${this._nextId}`
      const mesh = this._buildWallMesh({ ...d, id })
      this._scene.add(mesh)
      this._walls.push({ id, mesh, data: { ...d, id } })
      const n = parseInt(id.replace('w_', ''))
      if (!isNaN(n) && n >= this._nextId) this._nextId = n + 1
    })
    this._updateStats()
    this._notifyWallsChanged()
  }

  _loadPath(pts) {
    pts.forEach(p => {
      const pos  = new THREE.Vector3(p.x, p.y, p.z)
      const geo  = new THREE.SphereGeometry(0.35, 8, 8)
      const mat  = new THREE.MeshBasicMaterial({ color: PATH_COLOR })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      mesh.userData.editorType  = 'path'
      mesh.userData.editorIndex = this._path.length
      this._pathRoot.add(mesh)
      this._path.push({ mesh, pos })
    })
    this._rebuildPathLine()
    this._pathRoot.visible = false   // hidden until editor opens
    this._updateStats()
    this._notifyPathChanged()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dispose
  // ──────────────────────────────────────────────────────────────────────────

  dispose() {
    const c = this._renderer.domElement
    c.removeEventListener('click',       this._cbClick)
    c.removeEventListener('contextmenu', this._cbCtx)
    window.removeEventListener('keydown', this._cbKey)
    this._oc.dispose()
    this._tc.dispose()
    this._scene.remove(this._grid)
    this._scene.remove(this._tc)
    this._scene.remove(this._pathRoot)
    document.body.removeChild(this._panel)
  }
}
