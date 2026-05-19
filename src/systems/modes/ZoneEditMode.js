// src/systems/modes/ZoneEditMode.js
// Zone editing — top-down ortho camera + TransformControls for move/scale.
// Click empty → place zone. Click zone mesh → select. Click tag pin → move tag.

import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { LAYER_CONFIG } from '../ZoneEditor.js'

const DEFAULT_ZONE_SIZE = 4
const LAYERS = Object.keys(LAYER_CONFIG)

export class ZoneEditMode {
  /**
   * @param {THREE.WebGLRenderer}                         renderer
   * @param {THREE.Scene}                                 scene
   * @param {import('../ZoneEditor.js').ZoneEditor}       zoneStore
   * @param {*}                                           lightingSystem
   * @param {import('../TagSystem.js').TagSystem}         tagSystem
   */
  constructor(renderer, scene, zoneStore, lightingSystem, tagSystem) {
    this._renderer  = renderer
    this._scene     = scene
    this._store     = zoneStore
    this._lighting  = lightingSystem
    this._tags      = tagSystem ?? null

    this.camera = zoneStore.camera

    this._raycaster    = new THREE.Raycaster()
    this._mouse        = new THREE.Vector2()
    this._selected     = null   // selected zone mesh
    this._selectedTag  = null   // selected tag object
    this._tcDragging   = false
    this._activeLayer  = LAYERS[0]

    this._tc = new TransformControls(this.camera, renderer.domElement)
    this._tc.setMode('translate')
    this._tc.setSpace('world')
    this._tc.visible = false
    scene.add(this._tc)

    this._tc.addEventListener('dragging-changed', e => {
      this._tcDragging = e.value
      if (!e.value) {
        if (this._selectedTag && this._tags) {
          this._tags.syncTagPosition(this._selectedTag)
          this._tags.save().catch(err => console.error('[ZoneEditMode] tag save failed:', err))
        } else if (this._selected) {
          this._saveZones()
        }
      }
    })

    this._buildLayerPanel()
  }

  // ─── Mode interface ───────────────────────────────────────────────────────────

  get bindings() {
    return [
      ['Click',            'select / place zone'],
      ['Click',            'click pin → move tag'],
      ['T',                'translate mode'],
      ['S',                'scale zone'],
      ['R',                'rotate zone (Y axis)'],
      ['Delete/Backspace', 'delete selected'],
      ['Ctrl+S',           'save zones'],
      ['Scroll',           'zoom'],
    ]
  }

  onEnter(_prevCamera) {
    this._store.setAllGroupsVisible(true)
    this._tc.visible = !!(this._selected || this._selectedTag)
    this._layerPanel.style.display = 'block'
    this._lighting?.setDevLighting(true)
    this._store.load()
  }

  onExit() {
    this._tc.detach()
    this._tc.visible = false
    this._store.setAllGroupsVisible(false)
    this._layerPanel.style.display = 'none'
    this._lighting?.setDevLighting(false)
    this._selected    = null
    this._selectedTag = null
  }

  onKey(e) {
    if (e.key === 't' || e.key === 'T') { this._setTcMode('translate'); return }
    if (e.key === 's' || e.key === 'S') {
      if (!this._selectedTag) this._setTcMode('scale')
      return
    }
    if (e.key === 'r' || e.key === 'R') {
      if (!this._selectedTag) this._setTcMode('rotate')
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { this._deleteSelected(); return }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      this._saveZones()
    }
  }

  _setTcMode(mode) {
    this._tc.setMode(mode)
    // In rotate mode, only Y axis makes sense for top-down editing
    this._tc.showX = mode !== 'rotate'
    this._tc.showZ = mode !== 'rotate'
    this._tc.showY = mode === 'rotate' || mode === 'translate'
  }

  onWheel(e) {
    const cam   = this.camera
    const scale = 1 + e.deltaY * 0.001
    cam.left   *= scale
    cam.right  *= scale
    cam.top    *= scale
    cam.bottom *= scale
    cam.updateProjectionMatrix()
  }

  onClick(e) {
    if (this._tcDragging) return
    this._handleClick(e)
  }

  update(_delta) {}

  // ─── Interaction ─────────────────────────────────────────────────────────────

  _handleClick(e) {
    const rect = this._renderer.domElement.getBoundingClientRect()
    this._mouse.set(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1
    )
    this._raycaster.setFromCamera(this._mouse, this.camera)

    // Tags take priority — check pins first
    if (this._tags) {
      const pinMeshes = this._tags.getAllPinMeshes()
      const tagHits   = this._raycaster.intersectObjects(pinMeshes, false)
      if (tagHits.length > 0) {
        const tag = this._tags.getTagForMesh(tagHits[0].object)
        if (tag) { this._selectTag(tag); return }
      }
    }

    // Then check zone rectangles
    const meshes = this._store.getAllMeshes()
    const hits   = this._raycaster.intersectObjects(meshes, false)
    if (hits.length > 0) {
      this._selectZone(hits[0].object)
      return
    }

    // Empty space — place a new zone
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const pt    = new THREE.Vector3()
    if (!this._raycaster.ray.intersectPlane(plane, pt)) return
    const mesh = this._store.addZone(this._activeLayer, pt.x, pt.z, DEFAULT_ZONE_SIZE, DEFAULT_ZONE_SIZE)
    if (mesh) {
      this._selectZone(mesh)
      this._saveZones()
    }
  }

  _selectZone(mesh) {
    this._selected    = mesh
    this._selectedTag = null
    this._setTcMode('translate')
    this._tc.attach(mesh)
    this._tc.visible = true
  }

  _selectTag(tag) {
    this._selectedTag = tag
    this._selected    = null
    this._setTcMode('translate')
    this._tc.attach(tag.group)
    this._tc.visible = true
  }

  _deleteSelected() {
    if (this._selectedTag && this._tags) {
      this._tags.removeTag(this._selectedTag)
      this._tags.save().catch(err => console.error('[ZoneEditMode] tag save failed:', err))
      this._tc.detach()
      this._tc.visible  = false
      this._selectedTag = null
      return
    }
    if (this._selected) {
      this._store.removeZone(this._selected)
      this._tc.detach()
      this._tc.visible = false
      this._selected   = null
      this._saveZones()
    }
  }

  async _saveZones() {
    try {
      await this._store.save()
    } catch (e) {
      console.error('[ZoneEditMode] Save failed:', e)
    }
  }

  // ─── Layer panel ─────────────────────────────────────────────────────────────

  _buildLayerPanel() {
    this._layerPanel = document.createElement('div')
    Object.assign(this._layerPanel.style, {
      position: 'fixed', top: '10px', left: '10px',
      background: 'rgba(0,0,0,.82)', color: '#bbb',
      padding: '10px 14px', zIndex: '300',
      fontFamily: 'monospace', fontSize: '12px',
      borderRadius: '4px', lineHeight: '2',
      display: 'none',
    })

    const title = document.createElement('div')
    title.textContent = 'LAYER'
    title.style.cssText = 'color:#fff;font-weight:bold;border-bottom:1px solid #444;padding-bottom:4px;margin-bottom:4px'
    this._layerPanel.appendChild(title)

    this._layerBtns = {}
    for (const name of LAYERS) {
      const cfg = LAYER_CONFIG[name]
      const btn = document.createElement('div')
      btn.textContent = name
      btn.style.cssText = 'cursor:pointer;padding:1px 0'
      btn.style.color   = `#${cfg.color.toString(16).padStart(6, '0')}`
      btn.addEventListener('click', () => this._setLayer(name))
      this._layerPanel.appendChild(btn)
      this._layerBtns[name] = btn
    }

    document.body.appendChild(this._layerPanel)
    this._highlightLayer()
  }

  _setLayer(name) {
    this._activeLayer = name
    this._highlightLayer()
  }

  _highlightLayer() {
    for (const [name, btn] of Object.entries(this._layerBtns)) {
      btn.style.fontWeight    = name === this._activeLayer ? 'bold'      : 'normal'
      btn.style.textDecoration = name === this._activeLayer ? 'underline' : 'none'
    }
  }
}
