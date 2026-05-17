import * as THREE from 'three'

/**
 * Zone-based event trigger system.
 * Position-in-volume check (not raycast). Edge-triggered on entry only.
 */
export class TriggerSystem {
  constructor() {
    /** @type {Array<{box: THREE.Box3, callback: Function, wasInside: boolean, id: string}>} */
    this._triggers = []
  }

  /**
   * Register a trigger volume.
   * @param {THREE.Box3} box - world-space AABB
   * @param {Function} callback - called once on player entry
   * @param {string} [id] - optional identifier for debugging
   */
  registerTrigger(box, callback, id = 'unnamed') {
    this._triggers.push({ box, callback, wasInside: false, id })
  }

  /**
   * Call every frame with the player's world position.
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
    for (const trigger of this._triggers) {
      const isInside = trigger.box.containsPoint(playerPosition)
      if (isInside && !trigger.wasInside) {
        trigger.callback()
        console.log(`[TriggerSystem] Fired trigger: ${trigger.id}`)
      }
      trigger.wasInside = isInside
    }
  }

  /**
   * Remove all registered triggers (call on scene teardown).
   */
  clear() {
    this._triggers = []
  }
}
