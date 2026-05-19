// src/systems/modes/OrbitMode.js
// Orbit mode — orbit camera for map editing and future object editing.
// Delegates to MapEditor for orbit controls and wall-placement logic.

export class OrbitMode {
  /**
   * @param {import('../MapEditor.js').MapEditor} mapEditor
   */
  constructor(mapEditor) {
    this._map   = mapEditor
    this.camera = mapEditor.getCamera()
  }

  // ─── Mode interface ───────────────────────────────────────────────────────────

  get bindings() {
    return [
      ['Left drag',  'orbit'],
      ['Right drag', 'pan'],
      ['Scroll',     'zoom'],
    ]
  }

  onEnter(prevCamera) {
    if (prevCamera) this._map.syncCameraFrom(prevCamera)
    if (!this._map.isActive) this._map.toggle()
  }

  onExit() {
    if (this._map.isActive) this._map.toggle()
  }

  onKey(e)        { /* MapEditor has its own key handling via its own listener */ }
  onKeyUp(e)      {}
  onMouseMove(e)  {}
  onMouseDown(e)  {}
  onMouseUp(e)    {}

  update(_delta) {
    this._map.update()  // orbit controls damping
  }
}
