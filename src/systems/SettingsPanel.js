import { Pane } from 'tweakpane'
import meta from '../../data/settings.meta.json'
import GameSettings from '../../data/settings.json'

export class SettingsPanel {
  constructor(presetManager, container) {
    this._pm        = presetManager
    this._container = container
    this._callbacks = {}
    this._bindings  = {}
    this._requires  = {}

    if (container) {
      Object.assign(container.style, {
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'hsla(0,0%,38%,1) transparent',
      })
    }

    this._pane = new Pane({ title: 'Horror Dev', container: container ?? document.body })
    this._applyTheme()
    this._build()
  }

  get pane() { return this._pane }

  _applyTheme() {
    const el = this._pane.element
    Object.assign(el.style, {
      '--tp-base-background-color':          'hsla(0,0%,8%,0.97)',
      '--tp-base-shadow-color':              'hsla(0,0%,0%,0.6)',

      '--tp-label-foreground-color':         'hsla(0,0%,92%,1)',

      '--tp-container-background-color':       'hsla(0,0%,18%,1)',
      '--tp-container-background-color-hover': 'hsla(0,0%,23%,1)',
      '--tp-container-background-color-focus': 'hsla(0,0%,23%,1)',
      '--tp-container-background-color-active':'hsla(0,0%,28%,1)',
      '--tp-container-foreground-color':       'hsla(38,90%,62%,1)',   // amber folder titles

      '--tp-input-background-color':           'hsla(0,0%,24%,1)',
      '--tp-input-background-color-hover':     'hsla(0,0%,30%,1)',
      '--tp-input-background-color-focus':     'hsla(0,0%,30%,1)',
      '--tp-input-background-color-active':    'hsla(0,0%,36%,1)',
      '--tp-input-foreground-color':           'hsla(0,0%,97%,1)',

      '--tp-button-background-color':          'hsla(0,0%,28%,1)',
      '--tp-button-background-color-hover':    'hsla(0,0%,36%,1)',
      '--tp-button-background-color-focus':    'hsla(0,0%,36%,1)',
      '--tp-button-background-color-active':   'hsla(0,0%,44%,1)',
      '--tp-button-foreground-color':          'hsla(0,0%,97%,1)',

      '--tp-groove-foreground-color':          'hsla(0,0%,38%,1)',
      '--tp-monitor-background-color':         'hsla(0,0%,14%,1)',
      '--tp-monitor-foreground-color':         'hsla(120,55%,65%,1)',

      // Fill dockview container width
      width: '100%',
    })
  }

  on(key, fn) {
    if (!this._callbacks[key]) this._callbacks[key] = []
    this._callbacks[key].push(fn)
  }

  applyAll() {
    for (const [key, fns] of Object.entries(this._callbacks)) {
      for (const fn of fns) fn(GameSettings[key])
    }
    this._evaluateConditions()
    this._updatePresetButtons()
  }

  _emit(key, value) {
    for (const fn of this._callbacks[key] ?? []) fn(value)
  }

  _toOptions(arr) {
    return arr.map(v => ({ text: v, value: v }))
  }

  _build() {
    const pane       = this._pane
    const folderRefs = {}

    for (const [folderId, folderMeta] of Object.entries(meta)) {
      const folder = pane.addFolder({ title: folderMeta.label, expanded: !folderMeta.closed })
      folderRefs[folderId] = folder

      for (const [key, settingMeta] of Object.entries(folderMeta.settings)) {
        const params = { label: settingMeta.label }
        if (settingMeta.options) params.options = this._toOptions(settingMeta.options)
        if (settingMeta.min  != null) params.min  = settingMeta.min
        if (settingMeta.max  != null) params.max  = settingMeta.max
        if (settingMeta.step != null) params.step = settingMeta.step
        const binding = folder.addBinding(GameSettings, key, params)
        binding.on('change', ({ value }) => { this._emit(key, value); this._evaluateConditions() })
        this._bindings[key] = binding
        if (settingMeta.requires) this._requires[key] = settingMeta.requires
      }
    }

    // Focus label — read-only display in the camera folder
    this._focusObj     = { label: 'none' }
    this._focusBinding = folderRefs.camera.addBinding(this._focusObj, 'label', {
      label:    'focus',
      readonly: true,
    })

    this._buildPresetsPanel()
  }

  _evaluateConditions() {
    for (const [key, conditions] of Object.entries(this._requires)) {
      const met = Object.entries(conditions).every(([dep, val]) => GameSettings[dep] === val)
      this._bindings[key].hidden = !met
    }
  }

  _refreshAll() {
    for (const binding of Object.values(this._bindings)) binding.refresh()
    for (const key of Object.keys(this._bindings)) this._emit(key, GameSettings[key])
    this._evaluateConditions()
    this._updatePresetButtons()
  }

  updateFocusLabel(label) {
    if (this._focusObj.label !== label) {
      this._focusObj.label = label
      this._focusBinding.refresh()
    }
  }

  _buildPresetsPanel() {
    const panel = document.createElement('div')
    this._presetsPanel  = panel
    this._presetBtnRefs = {}   // name → button element

    Object.assign(panel.style, {
      width:      '100%',
      background: 'hsla(0,0%,8%,0.97)',
      borderTop:  '1px solid hsla(0,0%,20%,1)',
      padding:    '8px 8px 10px',
      fontFamily: 'var(--tp-font-family, monospace)',
      fontSize:   '11px',
      color:      'hsla(0,0%,92%,1)',
      boxSizing:  'border-box',
      userSelect: 'none',
    })

    const header = document.createElement('div')
    Object.assign(header.style, {
      fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'hsla(38,90%,62%,1)', marginBottom: '6px', paddingLeft: '2px',
    })
    header.textContent = 'Presets'
    panel.appendChild(header)

    // ── Base states: Play / Dev ───────────────────────────────────────────────
    panel.appendChild(this._makePresetRow(['Play', 'Dev']))

    // ── Fly modes: Fly / Spirit (require body) ────────────────────────────────
    panel.appendChild(this._makePresetRow(['Fly', 'Spirit']))

    // ── Divider ───────────────────────────────────────────────────────────────
    const hr = document.createElement('div')
    Object.assign(hr.style, {
      height: '1px', background: 'hsla(0,0%,25%,1)', margin: '6px 0',
    })
    panel.appendChild(hr)

    // ── Inspection: Orbit ─────────────────────────────────────────────────────
    panel.appendChild(this._makePresetRow(['Orbit']))

    if (this._container) {
      this._container.appendChild(panel)
    } else {
      this._pane.element.after(panel)
    }
    this._updatePresetButtons()
  }

  _makePresetRow(names) {
    const row = document.createElement('div')
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: `repeat(${names.length}, 1fr)`,
      gap: '4px', marginBottom: '4px',
    })
    for (const name of names) {
      const btn = this._makeBtn(name, () => {
        if (this._pm.activePreset === name) {
          this._pm.deactivate()
        } else {
          this._pm.activate(name)
        }
        this._refreshAll()
      })
      this._presetBtnRefs[name] = btn
      row.appendChild(btn)
    }
    return row
  }

  _updatePresetButtons() {
    if (!this._presetBtnRefs) return
    const active = this._pm.activePreset
    for (const [name, btn] of Object.entries(this._presetBtnRefs)) {
      const isActive = name === active
      const canUse   = this._pm.canActivate(name)

      btn.style.display    = canUse || isActive ? '' : 'none'
      btn.style.background = isActive ? 'hsla(38,90%,40%,1)' : 'hsla(0,0%,28%,1)'
      btn.style.color      = isActive ? 'hsla(0,0%,8%,1)'    : 'hsla(0,0%,97%,1)'
      btn.style.fontWeight = isActive ? '700' : '400'
    }
  }

  // ─── Path Manager ─────────────────────────────────────────────────────────

  buildPathManager(pathRecorder) {
    this._pr = pathRecorder

    const panel = document.createElement('div')
    this._pathPanel = panel
    panel.style.display = 'none'
    Object.assign(panel.style, {
      width:      '100%',
      background: 'hsla(0,0%,8%,0.97)',
      borderTop:  '1px solid hsla(0,0%,20%,1)',
      padding:    '8px 8px 10px',
      fontFamily: 'var(--tp-font-family, monospace)',
      fontSize:   '11px',
      color:      'hsla(0,0%,92%,1)',
      boxSizing:  'border-box',
      userSelect: 'none',
    })

    const header = document.createElement('div')
    Object.assign(header.style, {
      fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'hsla(38,90%,62%,1)', marginBottom: '6px', paddingLeft: '2px',
    })
    header.textContent = 'Paths'
    panel.appendChild(header)

    // Current path label
    this._pathCurrentEl = document.createElement('div')
    Object.assign(this._pathCurrentEl.style, {
      paddingLeft: '2px', marginBottom: '6px', color: 'hsla(0,0%,65%,1)',
    })
    panel.appendChild(this._pathCurrentEl)

    // Select + Refresh row
    const selRow = document.createElement('div')
    Object.assign(selRow.style, { display: 'flex', gap: '4px', marginBottom: '4px' })

    this._pathSelect = document.createElement('select')
    Object.assign(this._pathSelect.style, {
      flex: '1', background: 'hsla(0,0%,24%,1)', color: 'hsla(0,0%,97%,1)',
      border: 'none', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit',
      borderRadius: '2px', cursor: 'pointer',
    })
    this._pathSelect.addEventListener('change', () => {
      const name = this._pathSelect.value
      if (name && name !== this._pr.name) this._pr.loadPath(name).then(() => this._refreshPathCurrent())
    })
    selRow.appendChild(this._pathSelect)
    selRow.appendChild(this._makeBtn('↺', () => this._refreshPathList(), 'hsla(0,0%,28%,1)'))
    panel.appendChild(selRow)

    // Play / Stop preview button
    this._playBtn = this._makeBtn('Play ▶', () => {
      if (this._pr.isPreviewPlaying) {
        this._pr.stopPreview()
      } else {
        this._pr.preview()
        this._playBtn.textContent = 'Stop ■'
      }
    })
    this._pr.onPreviewEnd = () => { if (this._playBtn) this._playBtn.textContent = 'Play ▶' }
    panel.appendChild(this._playBtn)

    // Spacer
    const sp = document.createElement('div')
    sp.style.height = '4px'
    panel.appendChild(sp)

    // New + Delete row
    const actRow = document.createElement('div')
    Object.assign(actRow.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' })
    actRow.appendChild(this._makeBtn('New', () => this._newPath()))
    actRow.appendChild(this._makeBtn('Delete', () => this._deletePath(), 'hsla(0,0%,22%,1)', 'hsla(0,60%,65%,1)'))
    panel.appendChild(actRow)

    if (this._container) this._container.appendChild(panel)
    else this._pane.element.after(panel)
  }

  showPathManager() {
    if (!this._pathPanel) return
    this._pathPanel.style.display = ''
    if (this._playBtn) this._playBtn.textContent = 'Play ▶'
    this._refreshPathList()
  }

  hidePathManager() {
    if (this._pathPanel) this._pathPanel.style.display = 'none'
  }

  _refreshPathCurrent() {
    if (this._pathCurrentEl) this._pathCurrentEl.textContent = `active: ${this._pr.name}`
    if (this._pathSelect) this._pathSelect.value = this._pr.name
  }

  async _refreshPathList() {
    try {
      const res   = await fetch('/dev/list-paths')
      const names = await res.json()
      this._pathSelect.innerHTML = ''
      for (const name of names) {
        const opt = document.createElement('option')
        opt.value = opt.textContent = name
        this._pathSelect.appendChild(opt)
      }
      if (!names.includes(this._pr.name)) {
        const opt = document.createElement('option')
        opt.value = opt.textContent = this._pr.name
        this._pathSelect.insertBefore(opt, this._pathSelect.firstChild)
      }
      this._pathSelect.value = this._pr.name
      this._refreshPathCurrent()
    } catch (e) {
      console.warn('[SettingsPanel] could not list paths', e)
    }
  }

  _newPath() {
    const name = prompt('Path name (letters, numbers, hyphens):')
    if (!name) return
    if (!/^[\w-]+$/.test(name)) { alert('Invalid name — use letters, numbers, hyphens only.'); return }
    this._pr.loadPath(name).then(() => this._refreshPathList())
  }

  async _deletePath() {
    const name = this._pr.name
    if (!confirm(`Delete path "${name}"? This cannot be undone.`)) return
    await fetch('/dev/delete-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const res   = await fetch('/dev/list-paths')
    const names = await res.json()
    const next  = names.find(n => n !== name) ?? 'intro'
    await this._pr.loadPath(next)
    this._refreshPathList()
  }

  _makeBtn(label, onClick, bg = 'hsla(0,0%,28%,1)', fg = 'hsla(0,0%,97%,1)') {
    const btn = document.createElement('button')
    btn.textContent = label
    Object.assign(btn.style, {
      background:   bg,
      color:        fg,
      border:       'none',
      padding:      '5px 8px',
      fontSize:     '11px',
      fontFamily:   'inherit',
      cursor:       'pointer',
      borderRadius: '2px',
      textAlign:    'center',
      transition:   'background 0.1s',
    })
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.2)' })
    btn.addEventListener('mouseleave', () => { btn.style.filter = '' })
    btn.addEventListener('click', onClick)
    return btn
  }
}
