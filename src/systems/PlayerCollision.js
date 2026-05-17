import * as THREE from 'three'

// Tunable constants
const CAPSULE_RADIUS = 0.4
const CAPSULE_HEIGHT = 1.8
const CAPSULE_CROUCH_HEIGHT = 1.0
const WALL_RAY_DISTANCE = CAPSULE_RADIUS + 0.1
const GROUND_RAY_ORIGIN_OFFSET = 0.5  // above player feet
const GROUND_RAY_MAX = 5.0
const MIN_FLOOR_Y = 0

export class PlayerCollision {
  constructor(desertMesh, templeMesh) {
    this._desertMesh = desertMesh
    this._templeMesh = templeMesh
    this._raycaster = new THREE.Raycaster()
    this._lastGroundY = 0
    this._isCrouching = false
    this._isGrounded = false
  }

  setCrouch(val) {
    this._isCrouching = val
  }

  /**
   * Resolve movement for the player.
   * @param {THREE.Vector3} position - current player position (eye level)
   * @param {THREE.Vector3} intendedMove - desired movement delta (world space)
   * @param {string} zone - 'desert' | 'temple'
   * @returns {{ resolvedMove: THREE.Vector3, groundY: number, isGrounded: boolean }}
   */
  resolve(position, intendedMove, zone) {
    const groundY = this._groundRaycast(position)
    const resolvedMove = this._wallBlock(position, intendedMove)
    return { resolvedMove, groundY, isGrounded: this._isGrounded }
  }

  _groundRaycast(position) {
    const capsuleHeight = this._isCrouching ? CAPSULE_CROUCH_HEIGHT : CAPSULE_HEIGHT
    // Ray origin: slightly above feet
    const origin = new THREE.Vector3(position.x, position.y - capsuleHeight * 0.5 + GROUND_RAY_ORIGIN_OFFSET, position.z)

    this._raycaster.set(origin, new THREE.Vector3(0, -1, 0))
    this._raycaster.far = GROUND_RAY_MAX

    const meshes = this._getMeshes()
    const hits = this._raycaster.intersectObjects(meshes, true)

    if (hits.length > 0) {
      this._lastGroundY = hits[0].point.y
      this._isGrounded = true
    } else {
      this._isGrounded = false
      // Fallback: hold last valid Y, clamp to minimum
      this._lastGroundY = Math.max(this._lastGroundY, MIN_FLOOR_Y)
    }

    return this._lastGroundY
  }

  _wallBlock(position, intendedMove) {
    if (intendedMove.lengthSq() < 0.00001) return intendedMove.clone()

    const capsuleHeight = this._isCrouching ? CAPSULE_CROUCH_HEIGHT : CAPSULE_HEIGHT
    const origin = new THREE.Vector3(position.x, position.y - capsuleHeight * 0.3, position.z)
    const meshes = this._getMeshes()
    const resolved = intendedMove.clone()

    // 4 cardinal directions: N E S W
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]

    for (const dir of dirs) {
      this._raycaster.set(origin, dir)
      this._raycaster.far = WALL_RAY_DISTANCE
      const hits = this._raycaster.intersectObjects(meshes, true)
      if (hits.length > 0) {
        // Remove velocity component along blocked direction
        const dot = resolved.dot(dir)
        if (dot > 0) resolved.addScaledVector(dir, -dot)
      }
    }

    return resolved
  }

  _getMeshes() {
    return [this._desertMesh, this._templeMesh].filter(Boolean)
  }
}
