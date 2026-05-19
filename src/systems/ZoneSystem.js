// src/systems/ZoneSystem.js
// Runtime zone evaluator — reads zones.json, answers isDark(x, z) queries.
// No per-frame work beyond queries. Called by SanitySystem and LightingSystem.

const DEV_WARNING = false  // log when position falls outside all zones

export class ZoneSystem {
  constructor() {
    this._zones = []
    this._loaded = false
    this._prevIsDark = false

    // Callbacks assigned by main.js
    this.onDarknessChange = null    // (isDark: boolean) => void
  }

  async load() {
    try {
      const res = await fetch('/data/zones.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      this._zones = await res.json()
      this._loaded = true
      console.log(`[ZoneSystem] Loaded ${this._zones.length} zones`)
    } catch (e) {
      console.warn('[ZoneSystem] Failed to load zones.json — all positions treated as light:', e.message)
      this._zones = []
      this._loaded = true
    }
  }

  /**
   * Is the given XZ coordinate in a dark zone?
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isDark(x, z) {
    if (!this._loaded) return false
    for (const zone of this._zones) {
      if (zone.layer !== 'dark_zones') continue
      const hw = zone.width / 2
      const hd = zone.depth / 2
      if (x >= zone.x - hw && x <= zone.x + hw &&
          z >= zone.z - hd && z <= zone.z + hd) {
        return true  // found in dark_zones — it is dark regardless of flag value
      }
    }
    if (DEV_WARNING) {
      console.debug(`[ZoneSystem] (${x.toFixed(1)}, ${z.toFixed(1)}) outside all dark_zones — defaulting to light`)
    }
    return false
  }

  /**
   * Light level for a position — 0 if dark, 1 if light.
   * Used by EnemySystem for detection radius scaling.
   */
  getPlayerLightLevel(x, z) {
    return this.isDark(x, z) ? 0 : 1
  }

  /**
   * All zones data — used by LightingSystem to create static lights.
   * @returns {Array}
   */
  get zones() {
    return this._zones
  }

  /**
   * Called each frame by main.js with current player position.
   * Emits darkness change events.
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
    if (!this._loaded || !playerPosition) return

    const dark = this.isDark(playerPosition.x, playerPosition.z)
    if (dark !== this._prevIsDark) {
      this._prevIsDark = dark
      this.onDarknessChange?.(dark)
    }
  }
}
