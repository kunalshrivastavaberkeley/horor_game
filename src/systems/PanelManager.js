// src/systems/PanelManager.js
// Creates the dockview workspace (Unity/Godot-style dockable panels).
// Call getContainer(id) after construction — containers are populated synchronously.

import { DockviewComponent } from 'dockview-core'
import 'dockview-core/dist/styles/dockview.css'

export class PanelManager {
  constructor() {
    this._containers = {}

    const appEl = document.getElementById('app')
    Object.assign(appEl.style, { position: 'fixed', inset: '0' })
    appEl.classList.add('dockview-theme-dark')

    const self = this

    this._dv = new DockviewComponent(appEl, {
      // createComponent is called synchronously during addPanel.
      // options.id is the panel ID from addPanel({ id: '...' }).
      // Must return { element, init } — dockview mounts element into the panel.
      createComponent(options) {
        const el = document.createElement('div')
        Object.assign(el.style, {
          width:         '100%',
          height:        '100%',
          display:       'flex',
          flexDirection: 'column',
          overflow:      'hidden',
        })
        self._containers[options.id] = el
        return { element: el, init() {} }
      },
    })

    this._buildLayout()
  }

  _buildLayout() {
    const dv = this._dv

    // Provide real dimensions before adding panels so initialWidth ratios are correct.
    // Without this, dockview starts at (0,0) and all panels get equal flex weight.
    dv.layout(window.innerWidth, window.innerHeight)

    // Viewport on the left
    dv.addPanel({ id: 'viewport', component: 'panel', title: 'Viewport' })

    // Inspector on the right
    dv.addPanel({
      id:           'settings',
      component:    'panel',
      title:        'Inspector',
      position:     { direction: 'right', referencePanel: 'viewport' },
      initialWidth: 320,
    })

    // Scene as a tab alongside Inspector in the same group
    dv.addPanel({
      id:       'scene',
      component: 'panel',
      title:    'Scene',
      position: { direction: 'within', referencePanel: 'settings' },
    })
  }

  getContainer(id) { return this._containers[id] }
}
