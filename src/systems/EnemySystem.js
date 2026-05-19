// src/systems/EnemySystem.js
// Monster — static position only. No visuals, no movement.
// Broadcasts proximity stage (0–4) and a 0–1 factor each frame.
// Stage rings are visible in god/dev mode.

import * as THREE from 'three'

// Stage radii — player entering each ring triggers a higher stage.
// Stage 0 = outside all rings. Stage 4 = inside the smallest ring.
const STAGE_RADII  = [24, 14, 8, 3]   // units from monster, outer → inner
const STAGE_COLORS = [0xffee00, 0xff8800, 0xff3300, 0xff0055]
const RING_SEGS    = 64

export class EnemySystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene    = scene
    this._position = new THREE.Vector3(-37.0, 5, -13.9)

    this._playerPosition = new THREE.Vector3()
    this._currentStage   = 0

    // Callbacks — assigned by main.js
    this.onEnemyProximityChange = null  // (factor: 0–1) => void
    this.onStageChange          = null  // (stage: 0–4)  => void

    this._buildStageRings()
  }

  // Kept for API compatibility — no-ops
  init()                {}
  setPlayerLightLevel() {}
  onArtifactPickedUp()  {}
  setPatrolPath()       {}

  setPlayerPosition(pos) {
    this._playerPosition.copy(pos)
  }

  // ─── Main update ─────────────────────────────────────────────────────────────

  update(_delta) {
    const dist = this._position.distanceTo(this._playerPosition)

    // Compute stage: highest ring the player is inside (closest wins)
    let stage = 0
    for (let i = STAGE_RADII.length - 1; i >= 0; i--) {
      if (dist <= STAGE_RADII[i]) { stage = i + 1; break }
    }

    if (stage !== this._currentStage) {
      this._currentStage = stage
      this.onStageChange?.(stage)
    }

    // Smooth 0–1 factor (1 = at monster position)
    const factor = Math.max(0, 1 - dist / STAGE_RADII[0])
    this.onEnemyProximityChange?.(factor)
  }

  // ─── God-mode helpers ─────────────────────────────────────────────────────────

  updateGodHelpers(visible) {
    for (const ring of this._rings) ring.visible = visible
  }

  _buildStageRings() {
    this._rings = []
    for (let i = 0; i < STAGE_RADII.length; i++) {
      const r   = STAGE_RADII[i]
      const pts = []
      for (let j = 0; j <= RING_SEGS; j++) {
        const a = (j / RING_SEGS) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: STAGE_COLORS[i],
          depthTest: false,
          transparent: true,
          opacity: 0.75,
        })
      )
      ring.position.copy(this._position)
      ring.renderOrder = 999
      ring.visible = false
      this._scene.add(ring)
      this._rings.push(ring)
    }
  }

  // ─── Public accessor ──────────────────────────────────────────────────────────

  get position() { return this._position }
  get stage()    { return this._currentStage }
}
