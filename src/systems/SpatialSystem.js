// src/systems/SpatialSystem.js
// Halls (nodes + edges) and Chambers (named polygon volumes).
// Editable in DevWalkMode while walking. Separate from the 2D zone system.

import * as THREE from 'three'

const NODE_COLOR      = 0x00ccff
const NODE_HOVER      = 0xffcc00
const NODE_ANCHOR     = 0x00ff88
const NODE_GRABBED    = 0xffffff
const NODE_CHAMBER    = 0xff8800   // node is in the active chamber buffer
const NODE_GATEWAY    = 0xaa44ff   // hall node on a chamber boundary edge — gateway
const GATEWAY_THRESHOLD = 0.8      // world units — how close to a boundary edge = gateway
const CHAMBER_COLOR   = 0xff8800
const CHAMBER_OPACITY = 0.22
const CHAMBER_HOVER_OPACITY = 0.42
const NODE_RADIUS  = 0.12
const LABEL_W      = 256
const LABEL_H      = 48

let _nextId = 1
const uid = () => String(_nextId++)

export class SpatialSystem {
  constructor(scene) {
    this._scene = scene
    this._group = new THREE.Group()
    this._group.visible = false
    scene.add(this._group)

    this._nodes    = []   // { id, position, label, mesh, sprite }
    this._edges    = []   // { id, a, b, label, line, sprite }
    this._chambers = []   // { id, nodes, label, mesh, sprite }

    this._hoveredNode    = null
    this._hoveredEdge    = null
    this._hoveredChamber = null
    this._anchorNode     = null
    this._grabbedNode    = null
    this._chamberNodes   = new Set()   // nodes currently in the chamber buffer
    this._gatewayMap     = new Map()   // node → chamber (auto-computed from spatial containment)

    this._raycaster = new THREE.Raycaster()
    this._raycaster.params.Line = { threshold: 0.35 }
    this._center    = new THREE.Vector2(0, 0)

    this._losMode      = false
    this._losRaycaster = new THREE.Raycaster()
  }

  // ─── Public reads ─────────────────────────────────────────────────────────────

  get hoveredNode()    { return this._hoveredNode }
  get hoveredEdge()    { return this._hoveredEdge }
  get hoveredChamber() { return this._hoveredChamber }
  get anchorNode()     { return this._anchorNode }
  get grabbedNode()    { return this._grabbedNode }
  get nodeCount()      { return this._nodes.length }
  get edgeCount()      { return this._edges.length }
  get chamberCount()   { return this._chambers.length }
  get visible()        { return this._group.visible }

  /** All chambers — used by the presence system for containment queries. */
  get chambers() { return this._chambers }

  /** node → chamber map — used by the presence system. */
  get gatewayMap() { return this._gatewayMap }

  /** True if this XZ position is strictly inside any chamber — node placement blocked here. */
  isInsideChamber(x, z) { return this.chamberAtPoint(x, z) !== null }

  /** Returns the chamber this XZ point is strictly inside, or null. */
  chamberAtPoint(x, z) {
    for (const chamber of this._chambers) {
      if (this._pointInPolygon(x, z, chamber.nodes)) return chamber
    }
    return null
  }

  /** Recompute gateway nodes: hall nodes on a chamber boundary (not inside, not boundary-defining). */
  computeGateways() {
    // Build the set of nodes that are chamber boundary vertices — exclude from gateway detection
    const boundaryNodes = new Set()
    for (const chamber of this._chambers) {
      for (const n of chamber.nodes) boundaryNodes.add(n)
    }

    const prev = new Map(this._gatewayMap)
    this._gatewayMap.clear()

    for (const node of this._nodes) {
      if (boundaryNodes.has(node)) continue   // chamber boundary node — not a gateway
      const x = node.position.x, z = node.position.z
      for (const chamber of this._chambers) {
        if (this._pointInPolygon(x, z, chamber.nodes)) break  // inside — blocked, not a gateway
        if (this._distToBoundary(x, z, chamber.nodes) <= GATEWAY_THRESHOLD) {
          this._gatewayMap.set(node, chamber)
          break
        }
      }
    }

    // Refresh colors for nodes whose status changed, plus all boundary nodes
    for (const node of this._nodes) {
      if (boundaryNodes.has(node) || prev.has(node) !== this._gatewayMap.has(node)) {
        this._refreshNodeColor(node)
      }
    }
  }

  /** Ray-cast point-in-polygon on XZ plane. */
  _pointInPolygon(x, z, polygonNodes) {
    const n = polygonNodes.length
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygonNodes[i].position.x, zi = polygonNodes[i].position.z
      const xj = polygonNodes[j].position.x, zj = polygonNodes[j].position.z
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
        inside = !inside
      }
    }
    return inside
  }

  /** Minimum distance from (x,z) to any EDGE SEGMENT of a polygon on XZ plane. */
  _distToBoundary(x, z, polygonNodes) {
    const n = polygonNodes.length
    let minDist = Infinity
    for (let i = 0; i < n; i++) {
      const a  = polygonNodes[i].position
      const b  = polygonNodes[(i + 1) % n].position
      const dx = b.x - a.x
      const dz = b.z - a.z
      const lenSq = dx * dx + dz * dz
      if (lenSq === 0) continue   // degenerate edge — skip
      // Project point onto segment, clamped to [0,1]
      const t  = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq))
      const cx = a.x + t * dx
      const cz = a.z + t * dz
      minDist  = Math.min(minDist, Math.sqrt((cx - x) ** 2 + (cz - z) ** 2))
    }
    return minDist
  }

  /** Call whenever the chamber buffer changes to keep node colors in sync. */
  setChamberNodes(nodes) {
    const prev = this._chamberNodes
    this._chamberNodes = new Set(nodes)
    const affected = new Set([...prev, ...this._chamberNodes])
    for (const node of affected) this._refreshNodeColor(node)
  }

  // ─── Nodes ────────────────────────────────────────────────────────────────────

  placeNode(position, label = '') {
    const geo  = new THREE.SphereGeometry(NODE_RADIUS, 8, 8)
    const mat  = new THREE.MeshBasicMaterial({ color: NODE_COLOR, depthTest: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(position)
    mesh.renderOrder = 999
    this._group.add(mesh)

    const node = { id: uid(), position: position.clone(), label, mesh, sprite: null }
    mesh.userData.spatialNode = node
    this._nodes.push(node)

    if (label) this._attachNodeSprite(node)
    this.computeGateways()
    return node
  }

  removeNode(node) {
    for (const e of this._edges.filter(e => e.a === node || e.b === node))         this._removeEdgeObj(e)
    for (const c of this._chambers.filter(c => c.nodes.includes(node))) this._removeChamberObj(c)

    this._group.remove(node.mesh)
    node.mesh.geometry.dispose()
    node.mesh.material.dispose()
    this._disposeSprite(node)

    this._nodes = this._nodes.filter(n => n !== node)
    if (this._hoveredNode === node) this._hoveredNode = null
    if (this._anchorNode  === node) this._anchorNode  = null
    if (this._grabbedNode === node) this._grabbedNode = null
  }

  relabelNode(node, label) {
    node.label = label
    this._disposeSprite(node)
    if (label) this._attachNodeSprite(node)
  }

  grabNode(node) {
    this._grabbedNode = node
    node.mesh.material.color.setHex(NODE_GRABBED)
  }

  dropNode() {
    if (!this._grabbedNode) return
    const node = this._grabbedNode
    this._grabbedNode = null
    this._refreshNodeColor(node)
  }

  _refreshNodeColor(node) {
    if (!node?.mesh) return
    const isBoundary = this._chambers.some(c => c.nodes.includes(node))
    if (node === this._grabbedNode)        node.mesh.material.color.setHex(NODE_GRABBED)
    else if (node === this._anchorNode)    node.mesh.material.color.setHex(NODE_ANCHOR)
    else if (this._chamberNodes.has(node)) node.mesh.material.color.setHex(NODE_CHAMBER)
    else if (isBoundary)                   node.mesh.material.color.setHex(CHAMBER_COLOR)
    else if (node === this._hoveredNode)   node.mesh.material.color.setHex(NODE_HOVER)
    else if (this._gatewayMap.has(node))   node.mesh.material.color.setHex(NODE_GATEWAY)
    else                                   node.mesh.material.color.setHex(NODE_COLOR)
  }

  updateNodePosition(node, newPos) {
    node.position.copy(newPos)
    node.mesh.position.copy(newPos)

    for (const edge of this._edges) {
      if (edge.a !== node && edge.b !== node) continue
      edge.line.geometry.setFromPoints([edge.a.position, edge.b.position])
      if (edge.sprite) {
        edge.sprite.position.copy(
          new THREE.Vector3().addVectors(edge.a.position, edge.b.position).multiplyScalar(0.5)
        )
      }
    }

    for (const chamber of this._chambers) {
      if (!chamber.nodes.includes(node)) continue
      chamber.mesh.geometry.dispose()
      chamber.mesh.geometry = this._buildChamberGeo(chamber.nodes.map(n => n.position))
      if (chamber.sprite) {
        const c = new THREE.Vector3()
        for (const n of chamber.nodes) c.add(n.position)
        chamber.sprite.position.copy(c.divideScalar(chamber.nodes.length))
      }
    }

    if (node.sprite) {
      node.sprite.position.set(newPos.x, newPos.y + NODE_RADIUS + 0.28, newPos.z)
    }
    this.computeGateways()
  }

  // ─── Anchor (chain start) ─────────────────────────────────────────────────────

  setAnchor(node) {
    const prev = this._anchorNode
    this._anchorNode = node
    if (prev) this._refreshNodeColor(prev)
    if (node) this._refreshNodeColor(node)
  }

  clearAnchor() {
    const prev = this._anchorNode
    this._anchorNode = null
    if (prev) this._refreshNodeColor(prev)
  }

  // ─── Edges ────────────────────────────────────────────────────────────────────

  addEdge(nodeA, nodeB, label = '') {
    if (nodeA === nodeB) return null
    if (this._edges.some(e => (e.a === nodeA && e.b === nodeB) || (e.a === nodeB && e.b === nodeA))) return null

    const geo  = new THREE.BufferGeometry().setFromPoints([nodeA.position, nodeB.position])
    const mat  = new THREE.LineBasicMaterial({ color: NODE_COLOR, depthTest: false })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 999
    this._group.add(line)

    const edge = { id: uid(), a: nodeA, b: nodeB, label, line, sprite: null }
    line.userData.spatialEdge = edge
    this._edges.push(edge)

    if (label) this._attachEdgeSprite(edge)
    return edge
  }

  removeEdge(edge) {
    this._removeEdgeObj(edge)
  }

  relabelEdge(edge, label) {
    edge.label = label
    this._disposeSprite(edge)
    if (label) this._attachEdgeSprite(edge)
  }

  // ─── Chambers ─────────────────────────────────────────────────────────────────

  addChamber(nodes, label = '') {
    if (nodes.length < 3) return null
    const geo  = this._buildChamberGeo(nodes.map(n => n.position))
    const mat  = new THREE.MeshBasicMaterial({
      color: CHAMBER_COLOR, transparent: true, opacity: CHAMBER_OPACITY,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 998
    this._group.add(mesh)

    const chamber = { id: uid(), nodes: [...nodes], label, mesh, sprite: null }
    mesh.userData.spatialChamber = chamber
    this._chambers.push(chamber)

    if (label) this._attachChamberSprite(chamber)
    this.computeGateways()
    return chamber
  }

  removeChamber(chamber) {
    this._removeChamberObj(chamber)
  }

  relabelChamber(chamber, label) {
    chamber.label = label
    this._disposeSprite(chamber)
    if (label) this._attachChamberSprite(chamber)
  }

  // Live preview mesh for a new chamber being drawn (not yet committed)
  updatePreviewChamber(nodes) {
    if (!this._previewChamberMesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: CHAMBER_COLOR, transparent: true, opacity: CHAMBER_OPACITY,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      })
      this._previewChamberMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
      this._previewChamberMesh.renderOrder = 998
      this._group.add(this._previewChamberMesh)
    }
    this._previewChamberMesh.geometry.dispose()
    this._previewChamberMesh.geometry = this._buildChamberGeo(nodes.map(n => n.position))
  }

  clearPreviewChamber() {
    if (!this._previewChamberMesh) return
    this._group.remove(this._previewChamberMesh)
    this._previewChamberMesh.geometry.dispose()
    this._previewChamberMesh.material.dispose()
    this._previewChamberMesh = null
  }

  updateChamber(chamber, nodes) {
    chamber.nodes = [...nodes]
    chamber.mesh.geometry.dispose()
    chamber.mesh.geometry = this._buildChamberGeo(nodes.map(n => n.position))
    if (chamber.sprite) {
      const c = new THREE.Vector3()
      for (const n of nodes) c.add(n.position)
      chamber.sprite.position.copy(c.divideScalar(nodes.length))
    }
    this.computeGateways()
  }

  // ─── Hover ────────────────────────────────────────────────────────────────────

  updateHover(camera) {
    this._raycaster.setFromCamera(this._center, camera)

    // Priority: node > edge > face
    // Include label sprites alongside meshes so aiming at a label counts as hovering the element
    const nodeTargets = this._nodes.flatMap(n => n.sprite ? [n.mesh, n.sprite] : [n.mesh])
    const nodeHits    = this._raycaster.intersectObjects(nodeTargets, false)
    const newNode     = nodeHits.length > 0 ? (nodeHits[0].object.userData.spatialNode ?? null) : null

    let newEdge = null
    if (!newNode && this._edges.length > 0) {
      const edgeTargets = this._edges.flatMap(e => e.sprite ? [e.line, e.sprite] : [e.line])
      const edgeHits    = this._raycaster.intersectObjects(edgeTargets, false)
      newEdge = edgeHits.length > 0 ? (edgeHits[0].object.userData.spatialEdge ?? null) : null
    }

    let newChamber = null
    if (!newNode && !newEdge && this._chambers.length > 0) {
      const chamberTargets = this._chambers.flatMap(c => c.sprite ? [c.mesh, c.sprite] : [c.mesh])
      const chamberHits    = this._raycaster.intersectObjects(chamberTargets, false)
      newChamber = chamberHits.length > 0 ? (chamberHits[0].object.userData.spatialChamber ?? null) : null
    }

    if (newNode !== this._hoveredNode) {
      const prev = this._hoveredNode
      this._hoveredNode = newNode
      if (prev) this._refreshNodeColor(prev)
      if (newNode) this._refreshNodeColor(newNode)
    }

    if (newEdge !== this._hoveredEdge) {
      if (this._hoveredEdge) this._hoveredEdge.line.material.color.setHex(NODE_COLOR)
      this._hoveredEdge = newEdge
      if (newEdge) newEdge.line.material.color.setHex(NODE_HOVER)
    }

    if (newChamber !== this._hoveredChamber) {
      if (this._hoveredChamber) this._hoveredChamber.mesh.material.opacity = CHAMBER_OPACITY
      this._hoveredChamber = newChamber
      if (newChamber) newChamber.mesh.material.opacity = CHAMBER_HOVER_OPACITY
    }
  }

  // ─── Visibility ──────────────────────────────────────────────────────────────

  toggleVisible() {
    this._group.visible = !this._group.visible
    return this._group.visible
  }

  setVisible(v) { this._group.visible = v }

  get losMode() { return this._losMode }

  setLosMode(enabled) {
    this._losMode = enabled
    if (!enabled) {
      for (const n of this._nodes)    { n.mesh.visible = true; if (n.sprite) n.sprite.visible = true }
      for (const e of this._edges)    { e.line.visible = true; if (e.sprite) e.sprite.visible = true }
      for (const c of this._chambers) { c.mesh.visible = true; if (c.sprite) c.sprite.visible = true }
    }
  }

  updateLos(origin, wallMeshes) {
    if (!this._losMode || !this._group.visible) return
    for (const node of this._nodes) {
      const vis = this._hasLos(origin, node.position, wallMeshes)
      node.mesh.visible = vis
      if (node.sprite) node.sprite.visible = vis
    }
    for (const edge of this._edges) {
      const vis = edge.a.mesh.visible || edge.b.mesh.visible
      edge.line.visible = vis
      if (edge.sprite) edge.sprite.visible = vis
    }
    for (const chamber of this._chambers) {
      const vis = chamber.nodes.some(n => n.mesh.visible)
      chamber.mesh.visible = vis
      if (chamber.sprite) chamber.sprite.visible = vis
    }
  }

  _hasLos(origin, target, wallMeshes) {
    const dir  = new THREE.Vector3().subVectors(target, origin)
    const dist = dir.length()
    if (dist < 0.01) return true
    this._losRaycaster.set(origin, dir.normalize())
    this._losRaycaster.far = dist - 0.05
    const hits = this._losRaycaster.intersectObjects(wallMeshes, false)
    return hits.length === 0
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  async load() {
    try {
      const res = await fetch('/data/spatial.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      const nodeMap = {}
      for (const nd of (data.nodes ?? [])) {
        const node = this.placeNode(new THREE.Vector3(nd.x, nd.y, nd.z), nd.label ?? '')
        node.id = nd.id
        nodeMap[nd.id] = node
      }
      for (const ed of (data.edges ?? [])) {
        const a = nodeMap[ed.a], b = nodeMap[ed.b]
        if (a && b) {
          const edge = this.addEdge(a, b, ed.label ?? '')
          if (edge) edge.id = ed.id
        }
      }
      for (const ch of (data.chambers ?? data.faces ?? [])) {
        const nodes = (ch.nodes ?? []).map(id => nodeMap[id]).filter(Boolean)
        if (nodes.length >= 3) {
          const chamber = this.addChamber(nodes, ch.label ?? '')
          if (chamber) chamber.id = ch.id
        }
      }
      this.computeGateways()
      console.log(`[SpatialSystem] Loaded ${this._nodes.length} nodes, ${this._edges.length} edges, ${this._chambers.length} chambers`)
    } catch {
      console.log('[SpatialSystem] No spatial.json — starting fresh')
    }
  }

  async save() {
    const data = {
      nodes:    this._nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, z: n.position.z, label: n.label })),
      edges:    this._edges.map(e => ({ id: e.id, a: e.a.id, b: e.b.id, label: e.label })),
      chambers: this._chambers.map(c => ({ id: c.id, nodes: c.nodes.map(n => n.id), label: c.label })),
    }
    const res = await fetch('/dev/save-spatial', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`[SpatialSystem] Saved ${data.nodes.length}n ${data.edges.length}e ${data.chambers.length}ch`)
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _removeEdgeObj(edge) {
    if (this._hoveredEdge === edge) this._hoveredEdge = null
    this._disposeSprite(edge)
    this._group.remove(edge.line)
    edge.line.geometry.dispose()
    edge.line.material.dispose()
    this._edges = this._edges.filter(e => e !== edge)
  }

  _removeChamberObj(chamber) {
    if (this._hoveredChamber === chamber) this._hoveredChamber = null
    this._disposeSprite(chamber)
    this._group.remove(chamber.mesh)
    chamber.mesh.geometry.dispose()
    chamber.mesh.material.dispose()
    this._chambers = this._chambers.filter(c => c !== chamber)
    this.computeGateways()
  }

  _buildChamberGeo(positions) {
    // Ear-clip triangulation projected onto XZ — handles concave rooms correctly
    const pts2d   = positions.map(p => new THREE.Vector2(p.x, p.z))
    const indices = THREE.ShapeUtils.triangulateShape(pts2d, [])
    const verts   = []
    for (const [a, b, c] of indices) {
      verts.push(...positions[a].toArray(), ...positions[b].toArray(), ...positions[c].toArray())
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return geo
  }

  _attachNodeSprite(node) {
    const sprite = this._makeSprite(node.label)
    sprite.position.set(node.position.x, node.position.y + NODE_RADIUS + 0.28, node.position.z)
    sprite.userData.spatialNode = node
    this._group.add(sprite)
    node.sprite = sprite
  }

  _attachEdgeSprite(edge) {
    const mid = new THREE.Vector3().addVectors(edge.a.position, edge.b.position).multiplyScalar(0.5)
    const sprite = this._makeSprite(edge.label)
    sprite.position.copy(mid)
    sprite.userData.spatialEdge = edge
    this._group.add(sprite)
    edge.sprite = sprite
  }

  _attachChamberSprite(chamber) {
    const centroid = new THREE.Vector3()
    for (const n of chamber.nodes) centroid.add(n.position)
    centroid.divideScalar(chamber.nodes.length)
    const sprite = this._makeSprite(chamber.label)
    sprite.position.copy(centroid)
    sprite.userData.spatialChamber = chamber
    this._group.add(sprite)
    chamber.sprite = sprite
  }

  _disposeSprite(obj) {
    if (!obj.sprite) return
    this._group.remove(obj.sprite)
    obj.sprite.material.map?.dispose()
    obj.sprite.material.dispose()
    obj.sprite = null
  }

  _makeSprite(text) {
    const canvas = document.createElement('canvas')
    canvas.width  = LABEL_W
    canvas.height = LABEL_H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(0,20,40,0.82)'
    ctx.fillRect(0, 0, LABEL_W, LABEL_H)
    ctx.strokeStyle = '#00ccff'
    ctx.lineWidth   = 2
    ctx.strokeRect(1, 1, LABEL_W - 2, LABEL_H - 2)
    ctx.fillStyle    = '#ffffff'
    ctx.font         = 'bold 18px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, LABEL_W / 2, LABEL_H / 2)
    const tex    = new THREE.CanvasTexture(canvas)
    const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.6, 0.32, 1)
    sprite.renderOrder = 999
    return sprite
  }
}
