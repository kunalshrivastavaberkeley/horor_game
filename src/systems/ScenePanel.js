// src/systems/ScenePanel.js
// Godot-style scene tree panel. Toggle with O.
// Modes: focus (orbit camera), highlight (flash), isolate (hide everything else).
// Click a section/group header to act on all items inside it.

import * as THREE from 'three'

const COLORS = {
  node:    '#00ccff',
  edge:    '#4488aa',
  chamber: '#ff8800',
  tag:     '#ff4422',
}

// Injected once — CSS hover is reliable; JS mouseenter/mouseleave is not.
const _style = document.createElement('style')
_style.textContent = `
  .sp-row:hover:not(.sp-selected) { background: rgba(0,204,255,0.05); }
  .sp-row.sp-selected              { background: rgba(0,204,255,0.12); }
  .sp-group-title:hover            { color: #ffffff !important; }
  .sp-section-title:hover          { color: #aabbcc !important; }
`
document.head.appendChild(_style)

export class ScenePanel {
  constructor(spatialSystem, tagSystem, cameraController, container) {
    this._spatial  = spatialSystem
    this._tags     = tagSystem
    this._cc       = cameraController

    this._mode           = 'focus'
    this._isolated       = null
    this._groupHighlight = null
    this._selectedRow    = null

    this._panel = this._buildPanel(container)
    this.refresh()
  }

  refresh() {
    this._selectedRow = null
    this._body.innerHTML = ''
    this._body.appendChild(this._buildSpatialGroup())
    this._body.appendChild(this._buildTagsGroup())
  }

  // ─── Tree building ────────────────────────────────────────────────────────────

  _buildSpatialGroup() {
    const nodes    = this._spatial._nodes
    const edges    = this._spatial._edges
    const chambers = this._spatial._chambers

    const allItems = [
      ...nodes.map(n => ({ type: 'node', item: n })),
      ...edges.map(e => ({ type: 'edge', item: e })),
      ...chambers.map(c => ({ type: 'chamber', item: c })),
    ]

    const { el, body } = this._makeGroup('Spatial', allItems.length,
      () => this._onGroupClick(allItems, body)
    )

    // Nodes section
    const nodeItems = nodes.map(n => ({ type: 'node', item: n }))
    const nodesSec  = this._makeSection('Nodes', nodes.length, () => this._onGroupClick(nodeItems, nodesSec.body))
    for (const node of nodes) {
      const label = node.label || `node ${node.id}`
      nodesSec.body.appendChild(
        this._makeRow('●', label, COLORS.node, () => this._onItemClick('node', node))
      )
    }
    body.appendChild(nodesSec.el)

    // Edges section
    const edgeItems = edges.map(e => ({ type: 'edge', item: e }))
    const edgesSec  = this._makeSection('Edges', edges.length, () => this._onGroupClick(edgeItems, edgesSec.body))
    for (const edge of edges) {
      const a     = edge.a.label || edge.a.id
      const b     = edge.b.label || edge.b.id
      const label = edge.label || `${a} → ${b}`
      edgesSec.body.appendChild(
        this._makeRow('─', label, COLORS.edge, () => this._onItemClick('edge', edge))
      )
    }
    body.appendChild(edgesSec.el)

    // Chambers section
    const chamberItems = chambers.map(c => ({ type: 'chamber', item: c }))
    const chambersSec  = this._makeSection('Chambers', chambers.length, () => this._onGroupClick(chamberItems, chambersSec.body))
    for (const chamber of chambers) {
      const label = chamber.label || `chamber ${chamber.id}`
      chambersSec.body.appendChild(
        this._makeRow('◆', label, COLORS.chamber, () => this._onItemClick('chamber', chamber))
      )
    }
    body.appendChild(chambersSec.el)

    return el
  }

  _buildTagsGroup() {
    const tags      = this._tags._tags
    const tagItems  = tags.map(t => ({ type: 'tag', item: t }))

    const { el, body } = this._makeGroup(`Tags  (${tags.length})`, tags.length,
      () => this._onGroupClick(tagItems, body)
    )

    for (const tag of tags) {
      body.appendChild(
        this._makeRow('◉', tag.label, COLORS.tag, () => this._onItemClick('tag', tag))
      )
    }

    return el
  }

  // ─── DOM widgets ─────────────────────────────────────────────────────────────

  _buildPanel(container) {
    const panel = container
    Object.assign(panel.style, {
      background: 'rgba(0,8,18,0.94)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: '12px',
      color: '#99bbcc', userSelect: 'none',
    })

    const modeBar = document.createElement('div')
    Object.assign(modeBar.style, {
      padding: '6px 10px',
      borderBottom: '1px solid #00ccff15',
      display: 'flex', gap: '5px', flexShrink: '0',
    })
    for (const mode of ['focus', 'highlight', 'isolate']) {
      const btn = document.createElement('button')
      btn.textContent  = mode
      btn.dataset.mode = mode
      Object.assign(btn.style, {
        flex: '1', padding: '3px 0',
        border: '1px solid #00ccff33',
        background: 'transparent', color: '#445566',
        fontFamily: 'monospace', fontSize: '10px',
        cursor: 'pointer', borderRadius: '2px',
        transition: 'color 0.1s, background 0.1s',
      })
      btn.addEventListener('click', () => this._setMode(mode, modeBar))
      modeBar.appendChild(btn)
    }
    this._setMode(this._mode, modeBar)

    const body = document.createElement('div')
    Object.assign(body.style, {
      flex: '1', overflowY: 'auto', padding: '4px 0',
      scrollbarWidth: 'thin', scrollbarColor: '#00ccff22 transparent',
    })
    this._body = body

    panel.appendChild(modeBar)
    panel.appendChild(body)
    return panel
  }

  _setMode(mode, modeBar) {
    this._mode = mode
    this._clearIsolate()
    this._clearGroupHighlight()
    this._deselectRow()
    for (const btn of modeBar.querySelectorAll('button')) {
      const active = btn.dataset.mode === mode
      btn.style.background = active ? '#00ccff18' : 'transparent'
      btn.style.color      = active ? '#00ccff'   : '#445566'
      btn.style.border     = active ? '1px solid #00ccff66' : '1px solid #00ccff22'
    }
  }

  _makeGroup(title, count, onSelectAll) {
    const el = document.createElement('div')
    Object.assign(el.style, { marginBottom: '2px' })

    const header = document.createElement('div')
    Object.assign(header.style, {
      padding: '5px 10px',
      color: '#00ccff', fontSize: '12px',
      display: 'flex', alignItems: 'center', gap: '0',
      borderBottom: '1px solid #00ccff12',
    })

    const arrow = document.createElement('span')
    arrow.textContent = '▼'
    Object.assign(arrow.style, {
      fontSize: '9px', display: 'inline-block',
      transition: 'transform 0.12s', cursor: 'pointer',
      padding: '2px 6px 2px 0', flexShrink: '0', color: '#557788',
    })

    const titleEl = document.createElement('span')
    titleEl.textContent = title
    titleEl.className   = 'group-title sp-group-title'
    Object.assign(titleEl.style, {
      cursor: 'pointer', flex: '1', color: '#00ccff',
    })

    const body = document.createElement('div')
    let open = true

    arrow.addEventListener('click', e => {
      e.stopPropagation()
      open = !open
      body.style.display    = open ? 'block' : 'none'
      arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
    })

    titleEl.addEventListener('click', () => {
      this._deselectRow()
      onSelectAll()
    })

    header.appendChild(arrow)
    header.appendChild(titleEl)
    el.appendChild(header)
    el.appendChild(body)
    return { el, body }
  }

  _makeSection(title, count, onSelectAll) {
    const el = document.createElement('div')
    Object.assign(el.style, { paddingLeft: '10px' })

    const header = document.createElement('div')
    Object.assign(header.style, {
      padding: '3px 8px',
      color: '#556677', fontSize: '10px',
      display: 'flex', alignItems: 'center', gap: '0',
    })

    const arrow = document.createElement('span')
    arrow.textContent = '▼'
    Object.assign(arrow.style, {
      fontSize: '8px', display: 'inline-block',
      transition: 'transform 0.12s', cursor: 'pointer',
      padding: '2px 5px 2px 0', flexShrink: '0', color: '#445566',
    })

    const titleEl = document.createElement('span')
    titleEl.textContent = `${title}  (${count})`
    titleEl.className   = 'sp-section-title'
    Object.assign(titleEl.style, { cursor: 'pointer', flex: '1' })

    const body = document.createElement('div')
    let open = true

    arrow.addEventListener('click', e => {
      e.stopPropagation()
      open = !open
      body.style.display    = open ? 'block' : 'none'
      arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
    })

    titleEl.addEventListener('click', () => {
      this._deselectRow()
      onSelectAll()
    })

    header.appendChild(arrow)
    header.appendChild(titleEl)
    el.appendChild(header)
    el.appendChild(body)
    return { el, body }
  }

  _makeRow(icon, label, iconColor, onClick) {
    const row = document.createElement('div')
    row.className = 'sp-row'
    Object.assign(row.style, {
      padding: '2px 8px 2px 30px',
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: '7px',
      whiteSpace: 'nowrap', overflow: 'hidden',
    })

    const iconEl = document.createElement('span')
    iconEl.textContent = icon
    Object.assign(iconEl.style, { color: iconColor, fontSize: '9px', flexShrink: '0' })

    const labelEl = document.createElement('span')
    labelEl.textContent = label
    Object.assign(labelEl.style, {
      overflow: 'hidden', textOverflow: 'ellipsis',
      whiteSpace: 'nowrap', color: '#99bbcc',
    })

    row.appendChild(iconEl)
    row.appendChild(labelEl)

    row.addEventListener('click', () => {
      this._deselectRow()
      this._selectedRow = row
      row.classList.add('sp-selected')
      onClick()
    })

    return row
  }

  _deselectRow() {
    if (this._selectedRow) {
      this._selectedRow.classList.remove('sp-selected')
      this._selectedRow = null
    }
    for (const row of this._body?.querySelectorAll('.sp-selected') ?? []) {
      row.classList.remove('sp-selected')
    }
    this._clearGroupHighlight()
  }

  // ─── Click actions ────────────────────────────────────────────────────────────

  _onItemClick(type, item) {
    if (this._mode === 'focus')     this._doFocus(type, item)
    if (this._mode === 'highlight') this._doHighlight(type, item)
    if (this._mode === 'isolate')   this._doIsolate(type, item)
  }

  // Group/section header click — act on all items
  _onGroupClick(items, containerEl) {
    this._deselectRow()
    if (containerEl) {
      for (const row of containerEl.querySelectorAll('.sp-row')) {
        row.classList.add('sp-selected')
      }
    }
    this._applyGroupHighlight(items)

    if (this._mode === 'focus') {
      const positions = items.map(({ type, item }) => this._getPosition(type, item)).filter(Boolean)
      if (positions.length === 0) return
      const center = positions.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(positions.length)
      this._cc.setFocusPoint(center, `${items.length} objects`)
      this._cc.setType('orbit')
    }
    if (this._mode === 'isolate') {
      this._doIsolateGroup(items)
    }
  }

  _doFocus(type, item) {
    const pos   = this._getPosition(type, item)
    const label = this._getLabel(type, item)
    this._cc.setFocusPoint(pos, label)
    this._cc.setType('orbit')
  }

  _doHighlight(type, item) {
    if (type === 'node') {
      this._flash(item.mesh.material, item.mesh.material.color.getHex())
    } else if (type === 'edge') {
      this._flash(item.line.material, item.line.material.color.getHex())
    } else if (type === 'chamber') {
      const orig = item.mesh.material.opacity
      item.mesh.material.opacity = 0.75
      setTimeout(() => { item.mesh.material.opacity = orig }, 500)
    } else if (type === 'tag') {
      item.group.traverse(c => {
        if (c.material?.color) {
          const orig = c.material.color.getHex()
          c.material.color.setHex(0xffff00)
          setTimeout(() => { c.material.color.setHex(orig) }, 500)
        }
      })
    }
  }

  _flash(material, origHex) {
    material.color.setHex(0xffffff)
    setTimeout(() => { material.color.setHex(0xffff00) }, 80)
    setTimeout(() => { material.color.setHex(origHex) }, 500)
  }

  _doIsolate(type, item) {
    if (this._isolated?.item === item) {
      this._clearIsolate()
      this._deselectRow()
      return
    }
    this._doIsolateGroup([{ type, item }])
    this._isolated.item = item  // mark single-item so toggle works
  }

  _doIsolateGroup(keepItems) {
    this._clearIsolate()
    const saved = []
    const keepSet = new Set(keepItems.map(k => k.item))

    const hide = (obj) => {
      if (!obj) return
      saved.push({ obj, was: obj.visible })
      obj.visible = false
    }

    for (const n of this._spatial._nodes) {
      if (keepSet.has(n)) continue
      hide(n.mesh); hide(n.sprite)
    }
    for (const e of this._spatial._edges) {
      if (keepSet.has(e)) continue
      hide(e.line); hide(e.sprite)
    }
    for (const c of this._spatial._chambers) {
      if (keepSet.has(c)) continue
      hide(c.mesh); hide(c.sprite)
    }
    for (const t of this._tags._tags) {
      if (keepSet.has(t)) continue
      hide(t.group)
    }

    // Ensure the relevant group layers are visible
    if (keepItems.some(k => k.type !== 'tag'))  this._spatial.setVisible(true)
    if (keepItems.some(k => k.type === 'tag'))   this._tags.setVisible(true)

    this._isolated = { item: null, saved }
  }

  _applyGroupHighlight(items) {
    this._clearGroupHighlight()
    const saved = []

    for (const { type, item } of items) {
      if (type === 'node') {
        const mat = item.mesh.material
        saved.push({ mat, orig: mat.color.getHex() })
        mat.color.setHex(0xffffff)
      } else if (type === 'edge') {
        const mat = item.line.material
        saved.push({ mat, orig: mat.color.getHex() })
        mat.color.setHex(0xffffff)
      } else if (type === 'chamber') {
        const mat = item.mesh.material
        saved.push({ mat, origOpacity: mat.opacity, orig: null })
        mat.opacity = 0.65
      } else if (type === 'tag') {
        item.group.traverse(c => {
          if (c.material?.color) {
            const mat = c.material
            saved.push({ mat, orig: mat.color.getHex() })
            mat.color.setHex(0xffffff)
          }
        })
      }
    }

    this._groupHighlight = { saved }
  }

  _clearGroupHighlight() {
    if (!this._groupHighlight) return
    for (const entry of this._groupHighlight.saved) {
      if (entry.orig !== null) entry.mat.color.setHex(entry.orig)
      if (entry.origOpacity !== undefined) entry.mat.opacity = entry.origOpacity
    }
    this._groupHighlight = null
  }

  _clearIsolate() {
    if (!this._isolated) return
    for (const { obj, was } of this._isolated.saved) obj.visible = was
    this._isolated = null
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  _getPosition(type, item) {
    if (type === 'node')    return item.position.clone()
    if (type === 'tag')     return item.group.position.clone()
    if (type === 'edge') {
      return new THREE.Vector3()
        .addVectors(item.a.position, item.b.position)
        .multiplyScalar(0.5)
    }
    if (type === 'chamber') {
      const c = new THREE.Vector3()
      for (const n of item.nodes) c.add(n.position)
      return c.divideScalar(item.nodes.length)
    }
  }

  _getLabel(type, item) {
    if (type === 'node')    return item.label || `node ${item.id}`
    if (type === 'edge')    return item.label || `${item.a.label || item.a.id} → ${item.b.label || item.b.id}`
    if (type === 'chamber') return item.label || `chamber ${item.id}`
    if (type === 'tag')     return item.label
  }
}
