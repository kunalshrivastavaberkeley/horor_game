// src/systems/ZoneEditor.js
// Zone data store — camera, layer mesh groups, load, save.
// No interaction logic; ZoneEditMode owns that.

import * as THREE from 'three'

const RECT_Y = 0.01  // slightly above XZ plane

export const LAYER_CONFIG = {
  dark_zones:      { color: 0xff0000, flag: 'dark',     alpha: 0.35 },
  artifact_spawns: { color: 0x0000ff, flag: 'spawn',    alpha: 0.35 },
  light_zones:     { color: 0xffff00, flag: 'light',    alpha: 0.25 },
  torch_zones:     { color: 0xff8800, flag: 'torch',    alpha: 0.35 },
  artifact_zones:  { color: 0x4488ff, flag: 'artifact', alpha: 0.25 },
}

export class ZoneEditor {
  constructor(scene) {
    this._scene       = scene
    this._layerGroups = {}

    // Top-down orthographic camera — shared with ZoneEditMode (main) and minimap (sub-viewport)
    const w = window.innerWidth
    const h = window.innerHeight
    this._frustum = 50
    this._camera = new THREE.OrthographicCamera(
      -this._frustum * w / h, this._frustum * w / h,
      this._frustum, -this._frustum,
      0.1, 1000
    )
    this._camera.position.set(0, 100, 0)
    this._camera.lookAt(0, 0, 0)
    this._camera.up.set(0, 0, -1)

    window.addEventListener('resize', () => {
      const aspect = window.innerWidth / window.innerHeight
      this._camera.left   = -this._frustum * aspect
      this._camera.right  =  this._frustum * aspect
      this._camera.updateProjectionMatrix()
    })

    for (const name of Object.keys(LAYER_CONFIG)) {
      const group = new THREE.Group()
      group.visible = false
      scene.add(group)
      this._layerGroups[name] = group
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  get camera() { return this._camera }

  /** Add a zone rectangle to a layer. Returns the mesh. */
  addZone(layer, x, z, width, depth, rotationY = 0) {
    const cfg = LAYER_CONFIG[layer]
    if (!cfg) { console.warn(`[ZoneEditor] Unknown layer: ${layer}`); return null }
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: cfg.alpha,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, RECT_Y, z)
    mesh.scale.set(width, 1, depth)
    mesh.rotation.y = rotationY
    mesh.renderOrder = 999
    mesh.userData.layer = layer
    this._layerGroups[layer].add(mesh)
    return mesh
  }

  /** Remove a zone mesh (finds its layer from userData). */
  removeZone(mesh) {
    const layer = mesh.userData.layer
    if (layer && this._layerGroups[layer]) {
      this._layerGroups[layer].remove(mesh)
    } else {
      // Fallback: search all groups
      for (const g of Object.values(this._layerGroups)) g.remove(mesh)
    }
    mesh.geometry.dispose()
    mesh.material.dispose()
  }

  /** Flat array of all zone meshes across all layers — used by ZoneEditMode for raycasting. */
  getAllMeshes() {
    const out = []
    for (const g of Object.values(this._layerGroups)) {
      for (const child of g.children) {
        if (child.isMesh) out.push(child)
      }
    }
    return out
  }

  getMeshesForLayer(layer) {
    return (this._layerGroups[layer]?.children ?? []).filter(c => c.isMesh)
  }

  setAllGroupsVisible(visible) {
    for (const g of Object.values(this._layerGroups)) g.visible = visible
  }

  setLayerVisible(layer, visible) {
    if (this._layerGroups[layer]) this._layerGroups[layer].visible = visible
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  async load() {
    try {
      const res = await fetch('/data/zones.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const zones = await res.json()
      this._clearAllMeshes()
      for (const z of zones) {
        this.addZone(z.layer, z.x, z.z, z.width, z.depth, z.rotationY ?? 0)
      }
      console.log(`[ZoneEditor] Loaded ${zones.length} zones`)
    } catch (e) {
      console.warn('[ZoneEditor] Failed to load zones.json:', e.message)
    }
  }

  async save() {
    const zones = []
    for (const [layerName, group] of Object.entries(this._layerGroups)) {
      const cfg = LAYER_CONFIG[layerName]
      for (const mesh of group.children) {
        if (!mesh.isMesh) continue
        zones.push({
          layer:     layerName,
          x:         mesh.position.x,
          z:         mesh.position.z,
          width:     mesh.scale.x,
          depth:     mesh.scale.z,
          rotationY: mesh.rotation.y,
          flag:      cfg.flag,
        })
      }
    }
    const res = await fetch('/dev/save-zones', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(zones),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`[ZoneEditor] Saved ${zones.length} zones`)
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _clearAllMeshes() {
    for (const group of Object.values(this._layerGroups)) {
      while (group.children.length > 0) {
        const child = group.children[0]
        group.remove(child)
        child.geometry?.dispose()
        child.material?.dispose()
      }
    }
  }
}
