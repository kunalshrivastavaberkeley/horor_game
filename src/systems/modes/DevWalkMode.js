// src/systems/modes/DevWalkMode.js
// Dev walk mode — first-person WASD + mouse with zone overlays, coords HUD,
// and lighting controls. Fully separate instance from PlayerWalkMode.

import * as THREE from 'three'
import { DEATH_Y } from '../PlayerController.js'

const MOUSE_SENSITIVITY  = 0.002
const PITCH_CLAMP        = Math.PI / 4 - 0.01
const STROKE_GAP_MS      = 50
const AMBIENT_STEP       = 0.05
const AMBIENT_MIN        = 0
const AMBIENT_MAX        = 2

export class DevWalkMode {
  constructor(camera, entity, renderer, gsm, modeManager, zoneEditor, lightingSystem, tagSystem, sceneManagement, spatialSystem) {
    this.camera          = camera
    this._entity         = entity
    this._renderer       = renderer
    this._gsm            = gsm
    this._mm             = modeManager
    this._zoneEditor     = zoneEditor
    this._lighting       = lightingSystem
    this._tags           = tagSystem
    this._scene          = sceneManagement
    this._spatial        = spatialSystem ?? null

    this._tagRaycaster   = new THREE.Raycaster()
    this._tagDot         = this._buildTagDot()
    gsm.scene.add(this._tagDot)

    this._killPlane      = this._buildKillPlane()
    this._killPlaneOn    = true
    gsm.scene.add(this._killPlane)

    this._yaw            = 0
    this._pitch          = 0
    this._keys           = {}
    this._pointerLocked  = false
    this._devLit         = false
    this._zonesVisible   = true

    this._strokeYaw      = 0
    this._strokePitch    = 0
    this._accumDx        = 0
    this._accumDy        = 0
    this._lastMoveMs     = 0
    this._losFilter      = false
    this._wallMeshes     = null

    // Chamber-collect mode state
    this._chamberMode    = false
    this._chamberBuffer  = []
    this._editingChamber = null   // non-null when editing an existing chamber

    this._buildChamberHUD()
  }

  get bindings() {
    return [
      ['WASD',      'move'],
      ['Mouse',     'look'],
      ['LClick',    'select / connect / place / grab'],
      ['RClick',    'deselect / drop'],
      ['E',         'interact'],
      ['T',         'place tag (prompt)'],
      ['X',         'delete hovered tag'],
      ['R',         'label hovered node/edge/face/tag'],
      ['G',         'toggle tags'],
      ['Z',         'toggle zones'],
      ['N',         'toggle halls & chambers'],
      ['V',         'chamber mode (click nodes → V commit)'],
      ['Backspace', 'delete hovered'],
      ['L',         'toggle dev lighting'],
      ['[  ]',      'ambient intensity'],
      ['F',         'toggle LOS node filter'],
      ['P',         'toggle Niko path visualizer'],
      ['K',         'toggle kill-plane (fall death threshold)'],
    ]
  }

  onEnter(_prevCamera) {
    this._zonesVisible = true
    this._zoneEditor.setAllGroupsVisible(true)
    this._spatial?.setVisible(true)
    this._tags?.showCrosshair(this.camera)
    this._tagDot.visible        = true
    this._killPlane.visible     = this._killPlaneOn
    if (this._gsm.isActive) {
      this._renderer.domElement.requestPointerLock()
    }
  }

  onExit() {
    if (this._losFilter) {
      this._losFilter = false
      this._spatial?.setLosMode(false)
    }
    this._zoneEditor.setAllGroupsVisible(false)
    this._spatial?.setVisible(false)
    this._tags?.hideCrosshair()
    this._tagDot.visible    = false
    this._killPlane.visible = false
    if (this._devLit) {
      this._lighting.setDevLighting(false)
      this._devLit = false
    }
    this._exitChamberMode()
    if (this._spatial?.grabbedNode) {
      this._spatial.dropNode()
      this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
    }
    document.exitPointerLock()
    this._entity.setBodyVisible(false)
  }

  onKey(e) {
    if (e.key === 't' || e.key === 'T') {
      if (this._tags) {
        const position = this._raycastTagPosition() ?? this._entity.playerPosition
        document.exitPointerLock()
        const label = window.prompt('Tag label:', `Tag ${this._tags.count + 1}`)
        if (label !== null) {
          this._tags.placeTag(position, label)
          this._tags.save().catch(err => console.warn('[DevWalkMode] tag save failed:', err))
        }
      }
      return
    }
    if (e.key === 'x' || e.key === 'X') {
      if (this._tags?.hoveredTag) {
        this._tags.removeHovered()
        this._tags.save().catch(err => console.warn('[DevWalkMode] tag save failed:', err))
      }
      return
    }
    if (e.key === 'r' || e.key === 'R') {
      if (this._tags?.hoveredTag) {
        document.exitPointerLock()
        const current  = this._tags.hoveredTag.label
        const newLabel = window.prompt('Rename tag:', current)
        if (newLabel !== null) {
          this._tags.renameHovered(newLabel)
          this._tags.save().catch(err => console.warn('[DevWalkMode] tag save failed:', err))
        }
      } else if (this._spatial?.hoveredNode) {
        const node = this._spatial.hoveredNode
        document.exitPointerLock()
        const newLabel = window.prompt('Node label:', node.label)
        if (newLabel !== null) {
          this._spatial.relabelNode(node, newLabel.trim())
          this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
        }
      } else if (this._spatial?.hoveredEdge) {
        const edge = this._spatial.hoveredEdge
        document.exitPointerLock()
        const newLabel = window.prompt('Edge label:', edge.label)
        if (newLabel !== null) {
          this._spatial.relabelEdge(edge, newLabel.trim())
          this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
        }
      } else if (this._spatial?.hoveredChamber) {
        const chamber = this._spatial.hoveredChamber
        document.exitPointerLock()
        const newLabel = window.prompt('Chamber name:', chamber.label)
        if (newLabel !== null) {
          this._spatial.relabelChamber(chamber, newLabel.trim())
          this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
        }
      }
      return
    }
    if (e.key === 'g' || e.key === 'G') {
      if (this._tags) {
        const on = this._tags.toggleTags()
        console.log(`[DevWalkMode] tags ${on ? 'on' : 'off'}`)
      }
      return
    }
    if (e.key === 'z' || e.key === 'Z') {
      this._zonesVisible = !this._zonesVisible
      this._zoneEditor.setAllGroupsVisible(this._zonesVisible)
      console.log(`[DevWalkMode] zones ${this._zonesVisible ? 'on' : 'off'}`)
      return
    }
    if (e.key === 'n' || e.key === 'N') {
      if (this._spatial) {
        const on = this._spatial.toggleVisible()
        console.log(`[DevWalkMode] spatial ${on ? 'on' : 'off'}`)
      }
      return
    }
    if (e.key === 'v' || e.key === 'V') {
      if (!this._spatial) return
      if (this._chamberMode) {
        if (this._chamberBuffer.length >= 3) {
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
          this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
        } else if (this._editingChamber && this._chamberBuffer.length < 3) {
          // fewer than 3 nodes left — delete the chamber
          this._spatial.removeChamber(this._editingChamber)
          this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
        }
        this._exitChamberMode()
      } else if (this._spatial.hoveredChamber) {
        // re-open existing chamber for editing
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
    if (e.key === 'f' || e.key === 'F') {
      if (!this._spatial) return
      this._losFilter = !this._losFilter
      if (this._losFilter) this._wallMeshes = this._getWallMeshes()
      this._spatial.setLosMode(this._losFilter)
      console.log(`[DevWalkMode] LOS filter ${this._losFilter ? 'on' : 'off'}`)
      return
    }
    if (e.key === 'Backspace') {
      if (this._tags?.hoveredTag) {
        this._tags.removeHovered()
        this._tags.save().catch(err => console.warn('[DevWalkMode] tag save failed:', err))
      } else if (this._spatial?.hoveredNode) {
        this._spatial.removeNode(this._spatial.hoveredNode)
        this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      } else if (this._spatial?.hoveredEdge) {
        this._spatial.removeEdge(this._spatial.hoveredEdge)
        this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      } else if (this._spatial?.hoveredChamber) {
        this._spatial.removeChamber(this._spatial.hoveredChamber)
        this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      }
      return
    }
    if (e.key === 'k' || e.key === 'K') {
      this._killPlaneOn       = !this._killPlaneOn
      this._killPlane.visible = this._killPlaneOn
      console.log(`[DevWalkMode] kill plane ${this._killPlaneOn ? 'on' : 'off'}`)
      return
    }
    if (e.key === 'l' || e.key === 'L') {
      this._devLit = !this._devLit
      this._lighting.setDevLighting(this._devLit)
      return
    }
    if (e.key === '[') {
      this._nudgeAmbient(-AMBIENT_STEP)
      return
    }
    if (e.key === ']') {
      this._nudgeAmbient(+AMBIENT_STEP)
      return
    }
    this._keys[e.code] = true
  }

  onKeyUp(e) {
    delete this._keys[e.code]
    if (e.code === 'KeyE') this._entity.interact()
    if (e.code === 'KeyP') this._entity.toggleNikoPathVis()
  }

  onMouseMove(e) {
    if (!this._pointerLocked || this._entity.isCameraFrozen) return

    const now = performance.now()
    if (now - this._lastMoveMs > STROKE_GAP_MS) {
      this._strokeYaw   = this._yaw
      this._strokePitch = this._pitch
      this._accumDx     = 0
      this._accumDy     = 0
    }
    this._lastMoveMs = now

    this._accumDx += e.movementX
    this._accumDy += e.movementY
    this._yaw     = this._strokeYaw   - this._accumDx * MOUSE_SENSITIVITY
    this._pitch   = this._strokePitch - this._accumDy * MOUSE_SENSITIVITY
    this._pitch   = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this._pitch))
  }

  onPointerLockChange(locked) {
    this._pointerLocked = locked
    if (!locked && this._gsm.isActive) {
      this._entity.onPause?.()
    }
  }

  onClick(_e) {
    if (this._gsm.isActive && !this._pointerLocked) {
      this._renderer.domElement.requestPointerLock()
    }
  }

  onMouseDown(e) {
    if (!this._spatial || !this._pointerLocked) return

    if (e.button === 2) {
      if (this._chamberMode) { this._exitChamberMode(); return }
      if (this._spatial.grabbedNode) {
        this._spatial.dropNode()
        this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      } else {
        this._spatial.clearAnchor()
      }
      return
    }

    if (e.button !== 0) return

    const hovered = this._spatial.hoveredNode
    const anchor  = this._spatial.anchorNode
    const grabbed = this._spatial.grabbedNode

    if (grabbed) {
      this._spatial.dropNode()
      this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      return
    }

    if (this._chamberMode) {
      let target
      if (hovered) {
        target = hovered
      } else {
        const pos = this._raycastTagPosition()
        if (!pos) return
        target = this._spatial.placeNode(pos)
      }
      const idx = this._chamberBuffer.indexOf(target)
      if (idx === -1) {
        this._chamberBuffer.push(target)
      } else {
        this._chamberBuffer.splice(idx, 1)
      }
      this._spatial.setChamberNodes(this._chamberBuffer)
      this._refreshChamberPreview()
      this._updateChamberHUD()
      return
    }

    if (hovered) {
      if (hovered === anchor) {
        this._spatial.grabNode(hovered)
      } else if (anchor) {
        this._spatial.addEdge(anchor, hovered)
        this._spatial.setAnchor(hovered)
        this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
      } else {
        this._spatial.setAnchor(hovered)
      }
    } else {
      const pos = this._raycastTagPosition()
      if (!pos) return
      if (this._spatial.isInsideChamber(pos.x, pos.z)) {
        console.warn('[DevWalkMode] Cannot place hall node inside a chamber')
        return
      }
      const node = this._spatial.placeNode(pos)
      if (anchor) this._spatial.addEdge(anchor, node)
      this._spatial.setAnchor(node)
      this._spatial.save().catch(err => console.warn('[DevWalkMode] spatial save failed:', err))
    }
  }

  update(delta) {
    if (!this._gsm.isActive) return

    const fwd   = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw))
    const right  = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw))
    const dir    = new THREE.Vector3()

    if (this._keys['KeyW'] || this._keys['ArrowUp'])    dir.addScaledVector(fwd,    1)
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  dir.addScaledVector(fwd,   -1)
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  dir.addScaledVector(right, -1)
    if (this._keys['KeyD'] || this._keys['ArrowRight']) dir.addScaledVector(right,  1)
    if (dir.lengthSq() > 0) dir.normalize()

    this._entity.setFacing(this._yaw)
    this._entity.move(dir, delta)

    if (!this._entity.isCameraFrozen) {
      this.camera.position.copy(this._entity.playerPosition)
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.y     = this._yaw
      this.camera.rotation.x     = this._pitch
    }

    const p = this._entity.playerPosition
    this._mm.setCoords(`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`)

    this._tags?.updateHover(this.camera)
    if (this._spatial?.visible) this._spatial.updateHover(this.camera)
    if (this._losFilter && this._spatial?.visible) {
      this._spatial.updateLos(this.camera.position, this._wallMeshes ?? [])
    }

    const hit = this._raycastTagPosition()
    if (hit && this._spatial?.grabbedNode) {
      this._spatial.updateNodePosition(this._spatial.grabbedNode, hit)
    }
    if (hit) {
      this._tagDot.position.copy(hit)
      this._tagDot.visible = true
    } else {
      this._tagDot.visible = false
    }
  }

  get lookAngles() { return { yaw: this._yaw, pitch: this._pitch } }

  setLookAngles(yaw, pitch) {
    this._yaw         = yaw
    this._pitch       = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, pitch))
    this._strokeYaw   = this._yaw
    this._strokePitch = this._pitch
    this._accumDx     = 0
    this._accumDy     = 0
  }

  _buildChamberHUD() {
    this._chamberHUD = document.createElement('div')
    Object.assign(this._chamberHUD.style, {
      position: 'fixed', bottom: '44px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(40,20,0,0.88)', color: '#ff8800',
      padding: '6px 14px', fontFamily: 'monospace', fontSize: '13px',
      borderRadius: '4px', border: '1px solid #ff8800',
      zIndex: '300', display: 'none', pointerEvents: 'none',
    })
    document.body.appendChild(this._chamberHUD)
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

  _exitChamberMode() {
    this._chamberMode    = false
    this._chamberBuffer  = []
    this._editingChamber = null
    this._spatial?.setChamberNodes([])
    this._clearChamberPreview()
    this._updateChamberHUD()
  }

  _refreshChamberPreview() {
    if (this._editingChamber) {
      // editing: update the real chamber mesh in place
      if (this._chamberBuffer.length >= 3) {
        this._spatial.updateChamber(this._editingChamber, this._chamberBuffer)
      }
      return
    }
    // new chamber: drive a temporary preview mesh
    if (this._chamberBuffer.length < 3) { this._clearChamberPreview(); return }
    this._spatial.updatePreviewChamber(this._chamberBuffer)
  }

  _clearChamberPreview() {
    this._spatial?.clearPreviewChamber()
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

  _buildTagDot() {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3300, depthTest: false })
    )
    dot.renderOrder = 999
    dot.visible = false
    return dot
  }

  _raycastTagPosition() {
    if (!this._scene) return null
    let mesh
    try { mesh = this._scene.getCatacombMesh() } catch { return null }
    if (!mesh) return null
    const meshes = []
    mesh.traverse(c => { if (c.isMesh) meshes.push(c) })
    this._tagRaycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    const hits = this._tagRaycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    return hits[0].point.clone()
  }

  _nudgeAmbient(delta) {
    const light = this._lighting._ambientLight
    if (!light) return
    light.intensity = Math.max(AMBIENT_MIN, Math.min(AMBIENT_MAX, light.intensity + delta))
  }
}
