// src/systems/DevEditor.js
// Keyboard-driven editing tools for spatial graph and tags.
// Active when settings.graphEditor or settings.tagEditor is true.
// Listens on window independently — no routing through CameraController.

import * as THREE from 'three'

export class DevEditor {
  /**
   * @param {import('./CameraController.js').CameraController} cameraController
   * @param {import('./GameSettings.js').GameSettings}         settings
   * @param {import('./SpatialSystem.js').SpatialSystem}       spatialSystem
   * @param {import('./TagSystem.js').TagSystem}               tagSystem
   * @param {import('./SceneManagement.js').SceneManagement}   sceneManagement
   * @param {import('./SpatialSystem.js').SpatialSystem}       gsm
   */
  constructor(cameraController, settings, spatialSystem, tagSystem, sceneManagement, gsm) {
    this._cc      = cameraController
    this._settings = settings
    this._spatial  = spatialSystem
    this._tags     = tagSystem
    this._scene    = sceneManagement
    this._gsm      = gsm

    this._tagRaycaster  = new THREE.Raycaster()
    this._tagDot        = this._buildTagDot()
    gsm.scene.add(this._tagDot)

    // Stats HUD (nodes / edges / chambers)
    this._statsHUD = this._buildStatsHUD()
    this._toast    = this._buildToast()

    // Chamber editing state
    this._chamberMode    = false
    this._chamberBuffer  = []
    this._editingChamber = null
    this._chamberHUD     = this._buildChamberHUD()

    this._losFilter   = false
    this._wallMeshes  = null

    window.addEventListener('keydown', e => this._onKey(e))
    window.addEventListener('keyup',   e => this._onKeyUp(e))
    window.addEventListener('mousedown', e => this._onMouseDown(e))
  }

  // Called each frame by coordinator
  update() {
    const cam = this._cc.activeCamera

    if (this._settings.graphEditor && this._spatial) {
      if (this._spatial.visible) this._spatial.updateHover(cam)
      if (this._losFilter && this._spatial.visible) {
        this._spatial.updateLos(cam.position, this._wallMeshes ?? [])
      }
    }

    if (this._settings.tagEditor && this._tags) {
      this._tags.updateHover(cam)
    }

    // Tag dot — show raycast hit point when graph or tag editor is active
    const editing = this._settings.graphEditor || this._settings.tagEditor
    if (editing) {
      const hit = this._raycastPosition()
      if (hit) {
        this._tagDot.position.copy(hit)
        this._tagDot.visible = true
        if (this._settings.graphEditor && this._spatial?.grabbedNode) {
          this._spatial.updateNodePosition(this._spatial.grabbedNode, hit)
        }
      } else {
        this._tagDot.visible = false
      }
    } else {
      this._tagDot.visible = false
    }

    // Stats HUD visibility
    this._statsHUD.style.display = this._settings.graphEditor ? 'block' : 'none'
    if (this._settings.graphEditor) this._updateStatsHUD()
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────────

  _onKey(e) {
    // Tag editing
    if (this._settings.tagEditor && this._tags) {
      if (e.key === 't' || e.key === 'T') {
        const pos = this._raycastPosition() ?? this._cc._player.playerPosition
        document.exitPointerLock()
        const label = window.prompt('Tag label:', `Tag ${this._tags.count + 1}`)
        if (label !== null) {
          this._tags.placeTag(pos, label)
          this._tags.save().catch(err => console.warn('[DevEditor] tag save failed:', err)); this.onDataChanged?.()
        }
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        if (this._tags.hoveredTag) {
          this._tags.removeHovered()
          this._tags.save().catch(err => console.warn('[DevEditor] tag save failed:', err)); this.onDataChanged?.()
        }
        return
      }
      if ((e.key === 'r' || e.key === 'R') && this._tags.hoveredTag) {
        document.exitPointerLock()
        const newLabel = window.prompt('Rename tag:', this._tags.hoveredTag.label)
        if (newLabel !== null) {
          this._tags.renameHovered(newLabel)
          this._tags.save().catch(err => console.warn('[DevEditor] tag save failed:', err)); this.onDataChanged?.()
        }
        return
      }
    }

    if (!this._settings.graphEditor || !this._spatial) return

    // Undo / redo
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey) {
      document.exitPointerLock()
      const ok = e.shiftKey ? this._spatial.redo() : this._spatial.undo()
      if (ok) {
        this._spatialSave()
        this._showToast(e.shiftKey ? 'Redo' : 'Undo', false)
        this._updateStatsHUD()
        this.onDataChanged?.()
      } else {
        this._showToast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', true)
      }
      return
    }

    // Relabel node / edge / chamber / tag
    if (e.key === 'r' || e.key === 'R') {
      if (this._spatial.hoveredNode) {
        const node = this._spatial.hoveredNode
        document.exitPointerLock()
        const newLabel = window.prompt('Node label:', node.label)
        if (newLabel !== null) {
          this._spatial._pushHistory()
          this._spatial.relabelNode(node, newLabel.trim())
          this._spatialSave()
        }
      } else if (this._spatial.hoveredEdge) {
        document.exitPointerLock()
        const newLabel = window.prompt('Edge label:', this._spatial.hoveredEdge.label)
        if (newLabel !== null) {
          this._spatial._pushHistory()
          this._spatial.relabelEdge(this._spatial.hoveredEdge, newLabel.trim())
          this._spatialSave()
        }
      } else if (this._spatial.hoveredChamber) {
        document.exitPointerLock()
        const newLabel = window.prompt('Chamber name:', this._spatial.hoveredChamber.label)
        if (newLabel !== null) {
          this._spatial._pushHistory()
          this._spatial.relabelChamber(this._spatial.hoveredChamber, newLabel.trim())
          this._spatialSave()
        }
      }
      return
    }

    if (e.key === 'z' || e.key === 'Z') {
      const on = this._spatial.toggleVisible()
      console.log(`[DevEditor] spatial ${on ? 'on' : 'off'}`)
      return
    }

    // Chamber mode
    if (e.key === 'v' || e.key === 'V') {
      if (this._chamberMode) {
        if (this._chamberBuffer.length >= 3) {
          this._spatial._pushHistory()
          if (this._editingChamber) {
            this._spatial.updateChamber(this._editingChamber, this._chamberBuffer)
          } else {
            this._spatial.clearPreviewChamber()
            const chamber = this._spatial.addChamber(this._chamberBuffer)
            if (chamber) {
              document.exitPointerLock()
              const name = window.prompt('Chamber name:', '')
              if (name) this._spatial.relabelChamber(chamber, name.trim())
            }
          }
          this._spatialSave()
          this._updateStatsHUD()
        } else if (this._editingChamber && this._chamberBuffer.length < 3) {
          this._spatial._pushHistory()
          this._spatial.removeChamber(this._editingChamber)
          this._spatialSave()
          this._updateStatsHUD()
        }
        this._exitChamberMode()
      } else if (this._spatial.hoveredChamber) {
        const ch = this._spatial.hoveredChamber
        this._editingChamber = ch
        this._chamberMode    = true
        this._chamberBuffer  = [...ch.nodes]
        this._spatial.setChamberNodes(this._chamberBuffer)
        this._updateChamberHUD()
      } else {
        this._chamberMode    = true
        this._chamberBuffer  = []
        this._editingChamber = null
        this._spatial.setChamberNodes([])
        this._updateChamberHUD()
      }
      return
    }

    // LOS filter
    if (e.key === 'f' || e.key === 'F') {
      this._losFilter = !this._losFilter
      if (this._losFilter) this._wallMeshes = this._getWallMeshes()
      this._spatial.setLosMode(this._losFilter)
      return
    }

    // Delete
    if (e.key === 'Backspace') {
      if (this._spatial.hoveredNode) {
        const node = this._spatial.hoveredNode
        const edgeCount = this._spatial._edges.filter(e => e.a === node || e.b === node).length
        const chamCount = this._spatial._chambers.filter(c => c.nodes.includes(node)).length
        if (edgeCount > 0 || chamCount > 0) {
          const parts = []
          if (edgeCount) parts.push(`${edgeCount} edge${edgeCount !== 1 ? 's' : ''}`)
          if (chamCount) parts.push(`${chamCount} chamber${chamCount !== 1 ? 's' : ''}`)
          document.exitPointerLock()
          if (!window.confirm(`Delete node? Also deletes: ${parts.join(' and ')}.`)) return
        }
        this._spatial._pushHistory()
        this._spatial.removeNode(node)
        this._spatialSave()
        this._updateStatsHUD()
      } else if (this._spatial.hoveredEdge) {
        this._spatial._pushHistory()
        this._spatial.removeEdge(this._spatial.hoveredEdge)
        this._spatialSave()
        this._updateStatsHUD()
      } else if (this._spatial.hoveredChamber) {
        document.exitPointerLock()
        if (!window.confirm(`Delete chamber "${this._spatial.hoveredChamber.label || 'unnamed'}"?`)) return
        this._spatial._pushHistory()
        this._spatial.removeChamber(this._spatial.hoveredChamber)
        this._spatialSave()
        this._updateStatsHUD()
      }
      return
    }
  }

  _onKeyUp(e) {
  }

  _onMouseDown(e) {
    if (!this._settings.graphEditor || !this._spatial) return
    if (!document.pointerLockElement) return  // only while in a locked camera mode

    if (e.button === 2) {
      if (this._chamberMode) { this._exitChamberMode(); return }
      if (this._spatial.grabbedNode) {
        this._spatial.dropNode(); this._spatialSave()
      } else {
        this._spatial.clearAnchor()
      }
      return
    }

    if (e.button !== 0) return

    const hovered = this._spatial.hoveredNode
    const anchor  = this._spatial.anchorNode
    const grabbed = this._spatial.grabbedNode

    if (grabbed) { this._spatial.dropNode(); this._spatialSave(); return }

    const isOtherChamberNode = (n) =>
      this._spatial._chambers.some(c => c !== this._editingChamber && c.nodes.includes(n))
    const isChamberBoundary = (n) =>
      this._spatial._chambers.some(c => c.nodes.includes(n))

    if (this._chamberMode) {
      let target
      if (hovered) {
        if (isOtherChamberNode(hovered)) {
          const owner = this._spatial._chambers.find(c => c !== this._editingChamber && c.nodes.includes(hovered))
          this._showToast(`Node belongs to "${owner?.label || 'another chamber'}" — can't share nodes`, true)
          return
        }
        target = hovered
      } else {
        const pos = this._raycastPosition()
        if (!pos) return
        this._spatial._pushHistory()
        target = this._spatial.placeNode(pos)
        this._updateStatsHUD()
      }
      const idx = this._chamberBuffer.indexOf(target)
      if (idx === -1) this._chamberBuffer.push(target)
      else this._chamberBuffer.splice(idx, 1)
      this._spatial.setChamberNodes(this._chamberBuffer)
      this._refreshChamberPreview()
      this._updateChamberHUD()
      return
    }

    if (hovered) {
      if (hovered === anchor) {
        this._spatial._pushHistory()
        this._spatial.grabNode(hovered)
      } else if (anchor) {
        if (isChamberBoundary(hovered)) {
          this._showToast('Cannot connect hall edge to a chamber boundary node', true); return
        }
        if (isChamberBoundary(anchor)) {
          this._showToast('Cannot connect hall edge from a chamber boundary node', true)
          this._spatial.clearAnchor(); return
        }
        this._spatial._pushHistory()
        this._spatial.addEdge(anchor, hovered)
        this._spatial.setAnchor(hovered)
        this._spatialSave()
        this._updateStatsHUD()
      } else {
        if (isChamberBoundary(hovered)) {
          this._showToast('Chamber boundary node — use V to edit it', true); return
        }
        this._spatial.setAnchor(hovered)
      }
    } else {
      const pos = this._raycastPosition()
      if (!pos) return
      if (this._spatial.isInsideChamber(pos.x, pos.z)) {
        console.warn('[DevEditor] Cannot place hall node inside a chamber'); return
      }
      this._spatial._pushHistory()
      const node = this._spatial.placeNode(pos)
      if (anchor) this._spatial.addEdge(anchor, node)
      this._spatial.setAnchor(node)
      this._spatialSave()
      this._updateStatsHUD()
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _raycastPosition() {
    if (!this._scene) return null
    let mesh
    try { mesh = this._scene.getCatacombMesh() } catch { return null }
    if (!mesh) return null
    const meshes = []
    mesh.traverse(c => { if (c.isMesh) meshes.push(c) })
    this._tagRaycaster.setFromCamera(new THREE.Vector2(0, 0), this._cc.activeCamera)
    const hits = this._tagRaycaster.intersectObjects(meshes, false)
    return hits.length > 0 ? hits[0].point.clone() : null
  }

  _getWallMeshes() {
    if (!this._scene) return []
    let mesh
    try { mesh = this._scene.getCatacombMesh() } catch { return [] }
    if (!mesh) return []
    const meshes = []
    mesh.traverse(c => { if (c.isMesh) meshes.push(c) })
    return meshes
  }

  _spatialSave() {
    this._spatial.save()
      .then(() => { this._showToast('Saved', false); this.onDataChanged?.() })
      .catch(err => { console.warn('[DevEditor] save failed:', err); this._showToast('Save FAILED', true) })
  }

  _exitChamberMode() {
    this._chamberMode    = false
    this._chamberBuffer  = []
    this._editingChamber = null
    this._spatial?.setChamberNodes([])
    this._spatial?.clearPreviewChamber()
    this._updateChamberHUD()
  }

  _refreshChamberPreview() {
    if (this._editingChamber) {
      if (this._chamberBuffer.length >= 3) this._spatial.updateChamber(this._editingChamber, this._chamberBuffer)
      return
    }
    if (this._chamberBuffer.length < 3) { this._spatial?.clearPreviewChamber(); return }
    this._spatial.updatePreviewChamber(this._chamberBuffer)
  }

  // ─── HUD / UI ─────────────────────────────────────────────────────────────────

  _buildTagDot() {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3300, depthTest: false })
    )
    dot.renderOrder = 999
    dot.visible = false
    return dot
  }

  _buildStatsHUD() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', bottom: '20px', right: '12px',
      background: 'rgba(0,20,40,0.78)', color: '#00ccff',
      padding: '4px 10px', fontFamily: 'monospace', fontSize: '12px',
      borderRadius: '3px', border: '1px solid #00ccff44',
      zIndex: '300', display: 'none', pointerEvents: 'none', lineHeight: '1.6',
    })
    document.body.appendChild(el)
    return el
  }

  _updateStatsHUD() {
    if (!this._spatial) return
    const { nodeCount: n, edgeCount: e, chamberCount: ch } = this._spatial
    const u = this._spatial._undoStack.length
    const r = this._spatial._redoStack.length
    this._statsHUD.textContent = `${n}n  ${e}e  ${ch}ch    undo:${u}  redo:${r}`
  }

  _buildToast() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', bottom: '44px', right: '12px',
      background: 'rgba(0,20,40,0.88)', color: '#00ccff',
      padding: '4px 12px', fontFamily: 'monospace', fontSize: '12px',
      borderRadius: '3px', border: '1px solid #00ccff',
      zIndex: '400', display: 'none', pointerEvents: 'none', transition: 'opacity 0.3s',
    })
    document.body.appendChild(el)
    return el
  }

  _showToast(msg, isError) {
    clearTimeout(this._toastTimer)
    this._toast.textContent        = msg
    this._toast.style.color        = isError ? '#ff4444' : '#00ccff'
    this._toast.style.borderColor  = isError ? '#ff4444' : '#00ccff'
    this._toast.style.display      = 'block'
    this._toast.style.opacity      = '1'
    this._toastTimer = setTimeout(() => {
      this._toast.style.opacity = '0'
      setTimeout(() => { this._toast.style.display = 'none' }, 300)
    }, isError ? 3000 : 1200)
  }

  _buildChamberHUD() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', bottom: '44px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(40,20,0,0.88)', color: '#ff8800',
      padding: '6px 14px', fontFamily: 'monospace', fontSize: '13px',
      borderRadius: '4px', border: '1px solid #ff8800',
      zIndex: '300', display: 'none', pointerEvents: 'none',
    })
    document.body.appendChild(el)
    return el
  }

  _updateChamberHUD() {
    if (!this._chamberMode) { this._chamberHUD.style.display = 'none'; return }
    this._chamberHUD.style.display = 'block'
    const n      = this._chamberBuffer.length
    const commit = n >= 3 ? '  |  V to commit' : ''
    const prefix = this._editingChamber
      ? `EDIT "${this._editingChamber.label || 'chamber'}"`
      : 'NEW CHAMBER'
    this._chamberHUD.textContent = `${prefix}  ${n} node${n !== 1 ? 's' : ''}${commit}  |  RClick to cancel`
  }
}
