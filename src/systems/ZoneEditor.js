// src/systems/ZoneEditor.js
// Dev-mode only top-down zone rectangle editor.
// DEV_MODE = false → zero cost, no objects created.
import * as THREE from 'three'

// Tunable constants
const DEV_MODE = false   // set true to enable editor during authoring sessions
const RECT_Y = 0.01      // slightly above XZ plane to avoid z-fighting
const AABB_EPSILON = 0.01
const PAN_SPEED = 0.5

const LAYER_CONFIG = {
  dark_zones:      { color: 0xff0000, flag: 'dark',     alpha: 0.35 },
  artifact_spawns: { color: 0x0000ff, flag: 'spawn',    alpha: 0.35 },
  light_zones:     { color: 0xffff00, flag: 'light',    alpha: 0.25 },
  torch_zones:     { color: 0xff8800, flag: 'torch',    alpha: 0.35 },
  artifact_zones:  { color: 0x4488ff, flag: 'artifact', alpha: 0.25 },
}

export class ZoneEditor {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   */
  constructor(renderer, scene) {
    this._renderer = renderer
    this._scene = scene

    if (!DEV_MODE) return  // zero-cost guard

    this._active = false
    this._activeLayer = 'dark_zones'
    this._layerGroups = {}
    this._selectedMesh = null
    this._drawStart = null
    this._drawMesh = null
    this._isDragging = false
    this._isResizing = false
    this._activeCornerIndex = -1
    this._cornerHandles = []
    this._dragOffset = new THREE.Vector2()
    this._panel = null
    this._raycaster = new THREE.Raycaster()
    this._mouse = new THREE.Vector2()

    // Orthographic camera — top-down
    const w = window.innerWidth
    const h = window.innerHeight
    this._frustum = 50
    this._orthoCamera = new THREE.OrthographicCamera(
      -this._frustum * w / h, this._frustum * w / h,
      this._frustum, -this._frustum,
      0.1, 1000
    )
    this._orthoCamera.position.set(0, 100, 0)
    this._orthoCamera.lookAt(0, 0, 0)
    this._orthoCamera.up.set(0, 0, -1)

    // Create layer groups
    for (const name of Object.keys(LAYER_CONFIG)) {
      const group = new THREE.Group()
      group.visible = false
      scene.add(group)
      this._layerGroups[name] = group
    }

    this._setupUI()
    this._bindEvents()
  }

  /** Toggle editor on/off (dev keybind) */
  toggle() {
    if (!DEV_MODE) return
    this._active ? this._deactivate() : this._activate()
  }

  /** Returns the ortho camera when active, null otherwise. Used by GSM to swap camera. */
  getActiveCamera() {
    if (!DEV_MODE || !this._active) return null
    return this._orthoCamera
  }

  _activate() {
    this._active = true
    for (const [name, group] of Object.entries(this._layerGroups)) {
      group.visible = (name === this._activeLayer)
    }
    this._panel.style.display = 'block'
    this._loadZones()
  }

  _deactivate() {
    this._active = false
    for (const group of Object.values(this._layerGroups)) group.visible = false
    this._panel.style.display = 'none'
    this._clearHandles()
    this._selectedMesh = null
  }

  _setupUI() {
    this._panel = document.createElement('div')
    Object.assign(this._panel.style, {
      position: 'fixed', top: '10px', left: '10px',
      background: 'rgba(0,0,0,.8)', color: '#fff',
      padding: '12px', zIndex: '200', display: 'none',
      fontFamily: 'monospace', fontSize: '13px', minWidth: '160px',
      borderRadius: '4px'
    })

    const title = document.createElement('div')
    title.textContent = 'Zone Editor'
    title.style.cssText = 'font-weight:bold;margin-bottom:8px;border-bottom:1px solid #555;padding-bottom:4px'
    this._panel.appendChild(title)

    this._layerListEl = document.createElement('div')
    this._layerListEl.style.marginBottom = '8px'
    for (const name of Object.keys(LAYER_CONFIG)) {
      const btn = document.createElement('div')
      btn.textContent = name
      btn.dataset.layer = name
      btn.style.cssText = 'cursor:pointer;padding:2px 0;'
      btn.addEventListener('click', () => this._setActiveLayer(name))
      this._layerListEl.appendChild(btn)
    }
    this._panel.appendChild(this._layerListEl)

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.gap = '4px'

    const saveBtn = document.createElement('button')
    saveBtn.id = 'ze-save'
    saveBtn.textContent = 'Save'
    saveBtn.style.cssText = 'flex:1;padding:3px;cursor:pointer'
    saveBtn.addEventListener('click', () => this._save(saveBtn))
    btnRow.appendChild(saveBtn)

    const delBtn = document.createElement('button')
    delBtn.textContent = 'Delete'
    delBtn.style.cssText = 'flex:1;padding:3px;cursor:pointer'
    delBtn.addEventListener('click', () => this._deleteSelected())
    btnRow.appendChild(delBtn)

    this._panel.appendChild(btnRow)
    document.body.appendChild(this._panel)
    this._updateLayerHighlight()
  }

  _setActiveLayer(name) {
    this._activeLayer = name
    if (this._active) {
      for (const [n, g] of Object.entries(this._layerGroups)) g.visible = (n === name)
    }
    this._updateLayerHighlight()
  }

  _updateLayerHighlight() {
    if (!this._layerListEl) return
    for (const el of this._layerListEl.children) {
      el.style.color = el.dataset.layer === this._activeLayer ? '#ff0' : '#fff'
    }
  }

  _bindEvents() {
    const canvas = this._renderer.domElement
    canvas.addEventListener('mousedown', e => { if (this._active) this._onMouseDown(e) })
    canvas.addEventListener('mousemove', e => { if (this._active) this._onMouseMove(e) })
    canvas.addEventListener('mouseup',   e => { if (this._active) this._onMouseUp(e) })
    window.addEventListener('keydown', e => {
      if (!this._active) return
      if (e.key === 'Delete') this._deleteSelected()
    })
    canvas.addEventListener('wheel', e => {
      if (!this._active) return
      const scale = 1 + e.deltaY * 0.001
      const cam = this._orthoCamera
      cam.left *= scale; cam.right *= scale; cam.top *= scale; cam.bottom *= scale
      cam.updateProjectionMatrix()
    })
  }

  _screenToWorld(e) {
    const rect = this._renderer.domElement.getBoundingClientRect()
    this._mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this._raycaster.setFromCamera(this._mouse, this._orthoCamera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const pt = new THREE.Vector3()
    this._raycaster.ray.intersectPlane(plane, pt)
    return pt
  }

  _onMouseDown(e) {
    const pt = this._screenToWorld(e)

    // Corner handles check first
    for (let i = 0; i < this._cornerHandles.length; i++) {
      const h = this._cornerHandles[i]
      if (new THREE.Vector2(h.position.x, h.position.z)
            .distanceTo(new THREE.Vector2(pt.x, pt.z)) < 0.5) {
        this._isResizing = true
        this._activeCornerIndex = i
        return
      }
    }

    // Existing mesh check
    this._raycaster.setFromCamera(this._mouse, this._orthoCamera)
    const group = this._layerGroups[this._activeLayer]
    const hits = this._raycaster.intersectObjects(group.children.filter(c => c.isMesh), false)
    if (hits.length > 0) {
      this._select(hits[0].object)
      this._isDragging = true
      this._dragOffset.set(pt.x - hits[0].object.position.x, pt.z - hits[0].object.position.z)
      return
    }

    // Start drawing new rect
    this._deselect()
    this._drawStart = new THREE.Vector2(pt.x, pt.z)
    this._startDrawRect(pt)
  }

  _onMouseMove(e) {
    const pt = this._screenToWorld(e)

    if (this._drawStart && this._drawMesh) {
      const cx = (this._drawStart.x + pt.x) / 2
      const cz = (this._drawStart.y + pt.z) / 2
      this._drawMesh.position.set(cx, RECT_Y, cz)
      const w = Math.abs(pt.x - this._drawStart.x) || 0.01
      const d = Math.abs(pt.z - this._drawStart.y) || 0.01
      this._drawMesh.scale.set(w, 1, d)
      return
    }

    if (this._isDragging && this._selectedMesh) {
      this._selectedMesh.position.x = pt.x - this._dragOffset.x
      this._selectedMesh.position.z = pt.z - this._dragOffset.y
      this._updateHandlePositions()
      return
    }

    if (this._isResizing && this._selectedMesh && this._activeCornerIndex >= 0) {
      // Update scale from center + corner position
      const m = this._selectedMesh
      m.scale.x = Math.abs(pt.x - m.position.x) * 2 || 0.01
      m.scale.z = Math.abs(pt.z - m.position.z) * 2 || 0.01
      this._updateHandlePositions()
    }
  }

  _onMouseUp(_e) {
    this._isDragging = false
    this._isResizing = false
    this._activeCornerIndex = -1

    if (this._drawStart && this._drawMesh) {
      const mesh = this._drawMesh
      this._drawMesh = null
      this._drawStart = null

      if (this._overlapCheck(mesh)) {
        // Flash red briefly then remove
        mesh.material.color.set(0xff0000)
        setTimeout(() => {
          this._scene.remove(mesh)
          mesh.geometry.dispose()
          mesh.material.dispose()
        }, 300)
        return
      }

      this._layerGroups[this._activeLayer].add(mesh)
      this._scene.remove(mesh) // was added to scene during draw, move to group
    }
  }

  _startDrawRect(pt) {
    const cfg = LAYER_CONFIG[this._activeLayer]
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: cfg.alpha, side: THREE.DoubleSide
    })
    this._drawMesh = new THREE.Mesh(geo, mat)
    this._drawMesh.position.set(pt.x, RECT_Y, pt.z)
    this._scene.add(this._drawMesh)  // temporary — moved to group on mouseup
  }

  _overlapCheck(newMesh) {
    const group = this._layerGroups[this._activeLayer]
    const nMinX = newMesh.position.x - newMesh.scale.x / 2 - AABB_EPSILON
    const nMaxX = newMesh.position.x + newMesh.scale.x / 2 + AABB_EPSILON
    const nMinZ = newMesh.position.z - newMesh.scale.z / 2 - AABB_EPSILON
    const nMaxZ = newMesh.position.z + newMesh.scale.z / 2 + AABB_EPSILON

    for (const mesh of group.children) {
      if (!mesh.isMesh) continue
      const eMinX = mesh.position.x - mesh.scale.x / 2 - AABB_EPSILON
      const eMaxX = mesh.position.x + mesh.scale.x / 2 + AABB_EPSILON
      const eMinZ = mesh.position.z - mesh.scale.z / 2 - AABB_EPSILON
      const eMaxZ = mesh.position.z + mesh.scale.z / 2 + AABB_EPSILON
      if (nMaxX > eMinX && nMinX < eMaxX && nMaxZ > eMinZ && nMinZ < eMaxZ) return true
    }
    return false
  }

  _select(mesh) {
    this._deselect()
    this._selectedMesh = mesh
    mesh.material.opacity = Math.min(mesh.material.opacity + 0.2, 1.0)
    this._spawnHandles(mesh)
  }

  _deselect() {
    if (this._selectedMesh) {
      const cfg = LAYER_CONFIG[this._activeLayer]
      if (this._selectedMesh.material) this._selectedMesh.material.opacity = cfg.alpha
      this._selectedMesh = null
    }
    this._clearHandles()
  }

  _spawnHandles(mesh) {
    this._clearHandles()
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    for (const [cx, cz] of corners) {
      const hGeo = new THREE.PlaneGeometry(0.4, 0.4)
      hGeo.rotateX(-Math.PI / 2)
      const hMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const h = new THREE.Mesh(hGeo, hMat)
      h.position.set(
        mesh.position.x + cx * mesh.scale.x,
        RECT_Y + 0.01,
        mesh.position.z + cz * mesh.scale.z
      )
      this._scene.add(h)
      this._cornerHandles.push(h)
    }
  }

  _updateHandlePositions() {
    if (!this._selectedMesh || this._cornerHandles.length < 4) return
    const m = this._selectedMesh
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = corners[i]
      this._cornerHandles[i].position.set(m.position.x + cx * m.scale.x, RECT_Y + 0.01, m.position.z + cz * m.scale.z)
    }
  }

  _clearHandles() {
    for (const h of this._cornerHandles) {
      this._scene.remove(h)
      h.geometry.dispose()
      h.material.dispose()
    }
    this._cornerHandles = []
  }

  _deleteSelected() {
    if (!this._selectedMesh) return
    this._layerGroups[this._activeLayer].remove(this._selectedMesh)
    this._selectedMesh.geometry.dispose()
    this._selectedMesh.material.dispose()
    this._clearHandles()
    this._selectedMesh = null
  }

  async _loadZones() {
    try {
      const res = await fetch('/data/zones.json')
      if (!res.ok) return
      const zones = await res.json()
      // Clear existing meshes first
      for (const group of Object.values(this._layerGroups)) {
        while (group.children.length > 0) {
          const child = group.children[0]
          group.remove(child)
          child.geometry?.dispose()
          child.material?.dispose()
        }
      }
      for (const z of zones) {
        const cfg = LAYER_CONFIG[z.layer]
        if (!cfg || !this._layerGroups[z.layer]) continue
        const geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        const mat = new THREE.MeshBasicMaterial({
          color: cfg.color, transparent: true, opacity: cfg.alpha, side: THREE.DoubleSide
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(z.x, RECT_Y, z.z)
        mesh.scale.set(z.width, 1, z.depth)
        this._layerGroups[z.layer].add(mesh)
      }
      console.log('[ZoneEditor] Zones loaded from disk')
    } catch (e) {
      console.warn('[ZoneEditor] Failed to load zones.json:', e.message)
    }
  }

  async _save(btn) {
    const zones = []
    for (const [layerName, group] of Object.entries(this._layerGroups)) {
      const cfg = LAYER_CONFIG[layerName]
      for (const mesh of group.children) {
        if (!mesh.isMesh) continue
        zones.push({
          layer: layerName,
          x: mesh.position.x,
          z: mesh.position.z,
          width: mesh.scale.x,
          depth: mesh.scale.z,
          flag: cfg.flag
        })
      }
    }
    try {
      const res = await fetch('/dev/save-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zones)
      })
      if (res.ok) {
        btn.style.color = '#0f0'
        setTimeout(() => { btn.style.color = '' }, 1000)
        console.log(`[ZoneEditor] Saved ${zones.length} zones`)
      } else {
        throw new Error(`HTTP ${res.status}`)
      }
    } catch (e) {
      console.error('[ZoneEditor] Save failed:', e)
      btn.style.color = '#f00'
      setTimeout(() => { btn.style.color = '' }, 1000)
    }
  }
}
