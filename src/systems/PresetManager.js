// src/systems/PresetManager.js
// Built-in preset snapshots only — no user-saved presets.
// Presets may declare `requires` (conditions that must be true to activate)
// and `onExit` (behavior when deactivated). Call init(systems) before using stateful presets.

import GameSettings    from '../../data/settings.json'
import BUILTIN_PRESETS from '../../data/presets.json'

export { BUILTIN_PRESETS }

export class PresetManager {
  constructor() {
    this._activePreset = null
    this._exitSnapshot = null
    this._systems      = null
  }

  get builtinNames() { return Object.keys(BUILTIN_PRESETS) }
  get activePreset() { return this._activePreset }

  // Call once after construction with { cameraController, playerController }
  init(systems) {
    this._systems = systems
  }

  canActivate(name) {
    const preset = BUILTIN_PRESETS[name]
    if (!preset?.requires) return true
    return Object.entries(preset.requires).every(([key, val]) => GameSettings[key] === val)
  }

  activate(name) {
    const preset = BUILTIN_PRESETS[name]
    if (!preset) { console.warn(`[PresetManager] Unknown preset: "${name}"`); return }

    // If a stateful preset is active, run its exit behavior before switching
    if (this._activePreset && this._activePreset !== name) {
      const current = BUILTIN_PRESETS[this._activePreset]
      if (current?.onExit) this.deactivate()
    }

    if (preset.requires) {
      for (const [key, val] of Object.entries(preset.requires)) {
        if (GameSettings[key] !== val) {
          console.warn(`[PresetManager] Cannot activate "${name}": ${key} must be ${val} (got ${GameSettings[key]})`)
          return
        }
      }
    }

    // Snapshot only the keys this preset modifies so deactivate can restore them
    this._exitSnapshot = {}
    for (const key of Object.keys(preset.settings)) {
      if (key in GameSettings) this._exitSnapshot[key] = GameSettings[key]
    }

    for (const [key, value] of Object.entries(preset.settings)) {
      if (key in GameSettings) GameSettings[key] = value
    }

    this._activePreset = name
  }

  deactivate() {
    if (!this._activePreset) return
    const preset = BUILTIN_PRESETS[this._activePreset]

    // flyReturn: teleport body to wherever the camera flew before restoring cameraType
    if (preset?.onExit === 'flyReturn' && this._systems) {
      const pos = this._systems.cameraController.cameraPosition
      this._systems.playerController.teleportTo(pos.x, pos.z)
    }
    // spiritReturn: no action — restoring cameraType to firstPerson snaps camera to body

    if (this._exitSnapshot) {
      for (const [key, value] of Object.entries(this._exitSnapshot)) {
        GameSettings[key] = value
      }
    }

    this._activePreset = null
    this._exitSnapshot = null
  }
}
