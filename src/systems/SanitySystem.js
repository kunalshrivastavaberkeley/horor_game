// src/systems/SanitySystem.js

// Tunable constants (all rates are per second)
const NIKO_HUG_RATE      = +0.15   // hugging Niko → sanity recovers fast
const NIKO_HELD_RATE     = +0.02   // holding Niko → sanity recovers slowly
const NIKO_AWAY_RATE     = -0.05   // Niko not held → sanity drains
const SHADOW_RATE        = -0.10   // in dark zone → sanity drains
const LIGHT_RATE         =  0.00   // in light zone → no change
const PROX_MAX_RATE      = -0.15   // enemy at full proximity → max drain rate
const DEPLETION_HOLD_MS  = 2500    // ms sanity must stay at 0 before game ends

// --- Curried rate functions ---
// Each takes its constants once at construction; runtime call takes current state.

function nikoRateFn(constants) {
  return (nikoState) => {
    if (nikoState === 'hugging') return constants.hug
    if (nikoState === 'held')    return constants.held
    return constants.away  // 'hugging' movement state treated same as away
  }
}

function darkRateFn(constants) {
  return (isDark) => isDark ? constants.shadow : constants.light
}

function proxRateFn(_constants) {
  // Stub until EnemySystem is built — always returns 0
  return (_factor) => 0
}

export class SanitySystem {
  /**
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(gsm) {
    this._gsm = gsm

    // Internal state
    this._sanity = 1.0            // 0–1 float; starts full
    this._nikoState = 'held'      // updated via event
    this._isDark = false          // updated via event
    this._enemyProximityFactor = 0  // 0–1; updated via event; defaults to 0

    // Curried rate functions constructed once with constants baked in
    this._nikoRate = nikoRateFn({ hug: NIKO_HUG_RATE, held: NIKO_HELD_RATE, away: NIKO_AWAY_RATE })
    this._darkRate = darkRateFn({ shadow: SHADOW_RATE, light: LIGHT_RATE })
    this._proxRate = proxRateFn({ maxRate: PROX_MAX_RATE })

    // Depletion hold state
    this._depletionTimer = 0    // ms accumulated at sanity 0
    this._depleted = false      // one-shot flag — prevents repeated fire
  }

  // --- Event receivers (called by other systems / main.js) ---

  /** @param {'held'|'hugging'} state */
  onNikoStateChange(state) {
    this._nikoState = state
  }

  /** @param {boolean} isDark */
  onDarknessChange(isDark) {
    this._isDark = isDark
  }

  /** @param {number} factor 0–1 */
  onEnemyProximityChange(factor) {
    this._enemyProximityFactor = factor
  }

  // --- Output accessor ---

  /** @returns {number} 0–1 */
  getSanity() {
    return this._sanity
  }

  // --- Per-frame update ---

  /** @param {number} delta seconds */
  update(delta) {
    if (!this._gsm.isActive) return  // no-op outside ACTIVE state
    if (this._depleted) return        // one-shot guard — stops after firing

    const rateDelta =
      this._nikoRate(this._nikoState) +
      this._darkRate(this._isDark) +
      this._proxRate(this._enemyProximityFactor)

    this._sanity = Math.max(0, Math.min(1, this._sanity + rateDelta * delta))

    if (this._sanity <= 0) {
      this._depletionTimer += delta * 1000  // seconds → ms
      if (this._depletionTimer >= DEPLETION_HOLD_MS) {
        this._depleted = true
        this._gsm.onSanityDepleted()
      }
    } else {
      // Recovered above 0 — reset hold timer
      this._depletionTimer = 0
    }
  }
}
