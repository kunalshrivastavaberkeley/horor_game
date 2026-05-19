// src/systems/ModeManager.js
// Central mode hub — owns ALL keyboard routing and the keybinds panel.
// Modes register themselves; ModeManager switches between them and routes events.

const MODE_SWITCH = { '1': 'playerWalk', '2': 'devWalk', '3': 'fly', '4': 'zoneEdit', '5': 'orbit' }

const MODE_LABELS = {
  playerWalk: '1·PLAY',
  devWalk:    '2·DEV',
  fly:        '3·FLY',
  zoneEdit:   '4·ZONE',
  orbit:      '5·ORBIT',
}

export class ModeManager {
  /**
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(renderer) {
    this._renderer  = renderer
    this._modes     = {}   // key → mode instance
    this._activeKey = null
    this._active    = null

    this._panel  = null
    this._coords = null
    this._buildPanel()
    this._bindEvents()
  }

  // ─── Registration ─────────────────────────────────────────────────────────────

  register(key, mode) {
    this._modes[key] = mode
  }

  /** Call after all modes are registered to enter the initial mode. */
  start(initialKey) {
    this._switchTo(initialKey)
  }

  // ─── Public reads ─────────────────────────────────────────────────────────────

  get activeCamera() { return this._active?.camera ?? null }

  /** Always the ZoneEdit camera — used as minimap sub-viewport. */
  get minimapCamera() { return this._modes.zoneEdit?.camera ?? null }

  get activeKey() { return this._activeKey }

  /** Called by coordinator each frame. */
  update(delta) {
    this._active?.update?.(delta)
  }

  /** Update coords line (called by WalkMode / FlyMode with position string). */
  setCoords(text) {
    if (this._coords) this._coords.textContent = text
  }

  // ─── Panel ───────────────────────────────────────────────────────────────────

  _buildPanel() {
    this._panel = this._el('div', {
      position: 'fixed', top: '10px', right: '10px',
      background: 'rgba(0,0,0,.82)', color: '#bbb',
      padding: '10px 14px', zIndex: '300',
      fontFamily: 'monospace', fontSize: '12px',
      borderRadius: '4px', lineHeight: '1.8',
      pointerEvents: 'none', userSelect: 'none',
      minWidth: '200px',
    })
    document.body.appendChild(this._panel)

    this._coords = this._el('div', {
      position: 'fixed', bottom: '10px', left: '10px',
      color: '#0f0', fontFamily: 'monospace', fontSize: '13px',
      background: 'rgba(0,0,0,.6)', padding: '4px 8px',
      borderRadius: '4px', zIndex: '300', pointerEvents: 'none',
    })
    document.body.appendChild(this._coords)
  }

  _refreshPanel() {
    if (!this._panel) return

    // Mode tab bar
    const tabs = Object.entries(MODE_LABELS).map(([key, label]) => {
      const active = key === this._activeKey
      const color  = active ? '#ff0' : '#666'
      return `<span style="color:${color}">${label}</span>`
    }).join('  ')

    // Current mode's keybindings
    const bindings = this._active?.bindings ?? []
    const rows = bindings.map(([key, desc]) =>
      `<div><span style="color:#adf">${key}</span>&nbsp;&nbsp;${desc}</div>`
    ).join('')

    const divider = '<div style="border-top:1px solid #444;margin:5px 0"></div>'

    this._panel.innerHTML = `<div>${tabs}</div>${divider}${rows}`
  }

  _el(tag, styles) {
    const el = document.createElement(tag)
    Object.assign(el.style, styles)
    return el
  }

  // ─── Event routing ────────────────────────────────────────────────────────────

  _bindEvents() {
    window.addEventListener('keydown', e => {
      const switchTarget = MODE_SWITCH[e.key]
      if (switchTarget) { this._switchTo(switchTarget); return }
      this._active?.onKey?.(e)
    })
    window.addEventListener('keyup', e => {
      this._active?.onKeyUp?.(e)
    })
    document.addEventListener('mousemove', e => {
      this._active?.onMouseMove?.(e)
    })
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this._renderer.domElement
      this._active?.onPointerLockChange?.(locked)
    })
    // Canvas-level events routed to active mode
    const canvas = this._renderer.domElement
    canvas.addEventListener('wheel', e => this._active?.onWheel?.(e))
    canvas.addEventListener('mousedown', e => this._active?.onMouseDown?.(e))
    canvas.addEventListener('mouseup',   e => this._active?.onMouseUp?.(e))
    canvas.addEventListener('click',     e => this._active?.onClick?.(e))
  }

  _switchTo(key) {
    if (!this._modes[key]) return
    const prevCamera = this._active?.camera ?? null
    this._active?.onExit?.()
    this._activeKey = key
    this._active    = this._modes[key]
    this._active.onEnter?.(prevCamera)
    this._refreshPanel()
  }
}
