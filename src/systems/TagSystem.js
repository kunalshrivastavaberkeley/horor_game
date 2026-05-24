// src/systems/TagSystem.js
// Dev-mode pinpoint tagging — pure Three.js, no CSS.
// Each tag is a single Group: pin meshes + billboard sprite label as children.
// One _tagGroup holds all tags; toggling it hides/shows everything together.

import * as THREE from 'three'

const PIN_COLOR      = 0xff3300
const PIN_HOVER      = 0xffaa00
const STEM_H         = 2.4
const STEM_R         = 0.06
const HEAD_R         = 0.22
const LABEL_W        = 256
const LABEL_H        = 64
const CROSSHAIR_SIZE = 0.05

export class TagSystem {
  constructor(scene) {
    this._scene      = scene
    this._tags       = []
    this._tagGroup   = new THREE.Group()
    this._hoveredTag = null
    this._crosshair  = null
    this._crosshairCam = null
    scene.add(this._tagGroup)

    this._raycaster = new THREE.Raycaster()
    this._center    = new THREE.Vector2(0, 0)
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  get count()       { return this._tags.length }
  get visible()     { return this._tagGroup.visible }

  /** IFocusable — returns all tags for CameraController examine mode. */
  getFocusables() {
    return this._tags.map((t, i) => ({
      id:       `tag_${i}`,
      label:    t.label,
      position: t.group.position.clone(),
    }))
  }
  get hoveredTag()  { return this._hoveredTag }

  /** Drop a pin+label at world `position`. Returns the tag object. */
  placeTag(position, label) {
    const seq  = this._tags.length + 1
    const text = (label && label.trim()) ? label.trim() : `Tag ${seq}`

    const group = new THREE.Group()
    group.position.copy(position)
    group.add(this._makeSprite(text))
    this._tagGroup.add(group)

    const tag = { position: position.clone(), label: text, group }
    this._tags.push(tag)

    console.log(`[TagSystem] #${seq} "${text}" at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`)
    return tag
  }

  /** Remove a specific tag object. */
  removeTag(tag) {
    this._tagGroup.remove(tag.group)
    tag.group.traverse(c => { c.geometry?.dispose(); c.material?.dispose() })
    this._tags = this._tags.filter(t => t !== tag)
    if (this._hoveredTag === tag) {
      this._hoveredTag = null
      this._setCrosshairHover(false)
    }
  }

  /** Remove whichever tag the crosshair is aimed at. Returns true if removed. */
  removeHovered() {
    if (!this._hoveredTag) return false
    this.removeTag(this._hoveredTag)
    return true
  }

  /** Rename whichever tag the crosshair is aimed at. Returns true if renamed. */
  renameHovered(newLabel) {
    if (!this._hoveredTag || !newLabel?.trim()) return false
    this.renameTag(this._hoveredTag, newLabel.trim())
    return true
  }

  /** Rebuild the label sprite on a tag with a new name. */
  renameTag(tag, newLabel) {
    tag.label = newLabel
    tag.group.traverse(c => {
      if (c.isSprite) {
        c.material.map?.dispose()
        c.material.dispose()
        tag.group.remove(c)
      }
    })
    tag.group.add(this._makeSprite(newLabel))
  }

  setVisible(v) {
    this._tagGroup.visible = v
  }

  toggleTags() {
    this._tagGroup.visible = !this._tagGroup.visible
    return this._tagGroup.visible
  }

  // ─── External raycasting ─────────────────────────────────────────────────────

  /** All pin meshes across all tags — pass to raycaster.intersectObjects. */
  getAllPinMeshes() {
    const sprites = []
    for (const tag of this._tags) {
      tag.group.traverse(c => { if (c.isSprite) sprites.push(c) })
    }
    return sprites
  }

  /** Which tag owns `mesh`? Returns null if not found. */
  getTagForMesh(mesh) {
    for (const tag of this._tags) {
      let found = false
      tag.group.traverse(c => { if (c === mesh) found = true })
      if (found) return tag
    }
    return null
  }

  /** After TC moves a tag group, call this to sync tag.position. */
  syncTagPosition(tag) {
    tag.position.copy(tag.group.position)
  }

  // ─── Crosshair ───────────────────────────────────────────────────────────────

  showCrosshair(camera) {
    if (!this._crosshair) this._buildCrosshair()
    camera.add(this._crosshair)
    this._crosshairCam = camera
  }

  hideCrosshair() {
    if (this._crosshair && this._crosshairCam) {
      this._crosshairCam.remove(this._crosshair)
    }
    this._crosshairCam = null
  }

  // ─── Hover update (called each frame from DevWalkMode.update) ────────────────

  updateHover(camera) {
    if (this._tags.length === 0) {
      if (this._hoveredTag) {
        this._setTagColor(this._hoveredTag, PIN_COLOR)
        this._hoveredTag = null
        this._setCrosshairHover(false)
      }
      return
    }

    this._raycaster.setFromCamera(this._center, camera)

    const spriteToTag = new Map()
    for (const tag of this._tags) {
      tag.group.traverse(c => { if (c.isSprite) spriteToTag.set(c, tag) })
    }

    const hits = this._raycaster.intersectObjects([...spriteToTag.keys()], false)
    const hit  = hits.length > 0 ? (spriteToTag.get(hits[0].object) ?? null) : null

    if (hit !== this._hoveredTag) {
      if (this._hoveredTag) this._setTagColor(this._hoveredTag, 0xffffff)
      this._hoveredTag = hit
      if (hit) this._setTagColor(hit, PIN_HOVER)
      this._setCrosshairHover(!!hit)
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  async load() {
    try {
      const res = await fetch('/data/tags.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list = await res.json()
      for (const t of list) {
        this.placeTag(new THREE.Vector3(t.x, t.y, t.z), t.label)
      }
      console.log(`[TagSystem] Loaded ${list.length} tags`)
    } catch {
      console.log('[TagSystem] No tags.json — starting fresh')
    }
  }

  async save() {
    // Read positions from group.position so post-TC-drag positions are captured
    const data = this._tags.map(t => ({
      x:     t.group.position.x,
      y:     t.group.position.y,
      z:     t.group.position.z,
      label: t.label,
    }))
    const res = await fetch('/dev/save-tags', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`[TagSystem] Saved ${data.length} tags`)
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _makePinInto(group) {
    const stemMat = new THREE.MeshBasicMaterial({ color: PIN_COLOR, depthTest: false })
    const headMat = new THREE.MeshBasicMaterial({ color: PIN_COLOR, depthTest: false })

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(STEM_R, STEM_R, STEM_H, 8), stemMat)
    stem.position.y = STEM_H / 2
    stem.renderOrder = 999
    group.add(stem)

    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 8), headMat)
    head.position.y = STEM_H
    head.renderOrder = 999
    group.add(head)
  }

  _makeSprite(text) {
    const canvas = document.createElement('canvas')
    canvas.width  = LABEL_W
    canvas.height = LABEL_H
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = 'rgba(0,0,0,0.78)'
    ctx.fillRect(0, 0, LABEL_W, LABEL_H)
    ctx.strokeStyle = '#ff3300'
    ctx.lineWidth   = 3
    ctx.strokeRect(2, 2, LABEL_W - 4, LABEL_H - 4)
    ctx.fillStyle    = '#ffffff'
    ctx.font         = 'bold 22px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, LABEL_W / 2, LABEL_H / 2)

    const tex    = new THREE.CanvasTexture(canvas)
    const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(2, 0.5, 1)
    sprite.renderOrder = 999
    // Local offset within the tag group — above the pin head
    sprite.position.set(0, 0.5, 0)
    return sprite
  }

  _setTagColor(tag, color) {
    tag.group.traverse(c => {
      if (c.isSprite) c.material.color.setHex(color)
    })
  }

  _buildCrosshair() {
    const makeTex = (stroke) => {
      const c   = document.createElement('canvas')
      c.width   = 64
      c.height  = 64
      const ctx = c.getContext('2d')
      ctx.strokeStyle = stroke
      ctx.lineWidth   = 2
      ctx.beginPath()
      ctx.moveTo(32, 14); ctx.lineTo(32, 26)
      ctx.moveTo(32, 38); ctx.lineTo(32, 50)
      ctx.moveTo(14, 32); ctx.lineTo(26, 32)
      ctx.moveTo(38, 32); ctx.lineTo(50, 32)
      ctx.stroke()
      ctx.fillStyle = stroke
      ctx.beginPath()
      ctx.arc(32, 32, 2, 0, Math.PI * 2)
      ctx.fill()
      return new THREE.CanvasTexture(c)
    }

    this._crosshairNormalMat = new THREE.MeshBasicMaterial({
      map: makeTex('rgba(255,255,255,0.9)'), transparent: true,
      depthTest: false, depthWrite: false,
    })
    this._crosshairHoverMat = new THREE.MeshBasicMaterial({
      map: makeTex('rgba(255,170,0,1)'), transparent: true,
      depthTest: false, depthWrite: false,
    })

    const geo = new THREE.PlaneGeometry(CROSSHAIR_SIZE, CROSSHAIR_SIZE)
    this._crosshair = new THREE.Mesh(geo, this._crosshairNormalMat)
    this._crosshair.position.set(0, 0, -1)
    this._crosshair.renderOrder = 9999
  }

  _setCrosshairHover(hover) {
    if (!this._crosshair) return
    this._crosshair.material = hover ? this._crosshairHoverMat : this._crosshairNormalMat
  }
}
