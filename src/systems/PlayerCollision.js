import * as THREE from 'three'

const PLAYER_RADIUS = 0.4
const EYE_HEIGHT    = 1.8
const STEP_HEIGHT   = 0.35   // max step up/down snapped by floor cast

export class PlayerCollision {
  constructor(catacombMesh) {
    this._raycaster   = new THREE.Raycaster()
    this._meshes      = []
    this._extraMeshes = []  // editor-placed walls, kept separate for easy replacement
    catacombMesh?.traverse(child => {
      if (child.isMesh) this._meshes.push(child)
    })
  }

  /**
   * Replace the set of extra (editor-placed) wall meshes used for collision.
   * Called every time the map editor's wall list changes.
   */
  setExtraWallMeshes(meshes) {
    this._extraMeshes = meshes.slice()
  }

  _allMeshes() {
    return this._extraMeshes.length > 0
      ? this._meshes.concat(this._extraMeshes)
      : this._meshes
  }

  // eyePos    — current camera/eye world position
  // intendedMove — delta this frame (x/z = horizontal, y = floor-seek probe)
  // bodyHeight  — current dynamic eye-above-floor height (auto-crouch value)
  // returns { resolvedMove: Vector3, isGrounded: bool }
  resolve(eyePos, intendedMove, bodyHeight = EYE_HEIGHT) {
    if (this._allMeshes().length === 0) {
      return { resolvedMove: intendedMove.clone(), isGrounded: false }
    }

    const feetY = eyePos.y - bodyHeight
    const hMove = new THREE.Vector3(intendedMove.x, 0, intendedMove.z)

    const resolvedH              = this._resolveHorizontal(eyePos, feetY, hMove, bodyHeight)
    const { floorY, grounded }   = this._findFloor(eyePos.x + resolvedH.x, feetY, eyePos.z + resolvedH.z)
    const resolvedY              = grounded ? (floorY - feetY) : intendedMove.y

    return {
      resolvedMove: new THREE.Vector3(resolvedH.x, resolvedY, resolvedH.z),
      isGrounded:   grounded,
    }
  }

  // Returns available vertical clearance above feetY (distance from floor to ceiling).
  // Returns Infinity when no ceiling is detected within standing height.
  findCeiling(x, feetY, z) {
    const originY = feetY + PLAYER_RADIUS
    this._raycaster.set(new THREE.Vector3(x, originY, z), new THREE.Vector3(0, 1, 0))
    this._raycaster.far = EYE_HEIGHT + 0.5
    const hits = this._raycaster.intersectObjects(this._allMeshes(), false)
    if (hits.length === 0) return Infinity
    return (originY + hits[0].distance) - feetY
  }

  // Try full horizontal move, then axis-aligned slides on block
  _resolveHorizontal(eyePos, feetY, hMove, bodyHeight = EYE_HEIGHT) {
    if (hMove.lengthSq() < 1e-8) return new THREE.Vector3()

    const midY = feetY + bodyHeight * 0.5

    if (!this._hitsWall(eyePos.x, midY, eyePos.z, hMove)) return hMove.clone()

    const slideX = new THREE.Vector3(hMove.x, 0, 0)
    if (Math.abs(hMove.x) > 1e-4 && !this._hitsWall(eyePos.x, midY, eyePos.z, slideX)) return slideX

    const slideZ = new THREE.Vector3(0, 0, hMove.z)
    if (Math.abs(hMove.z) > 1e-4 && !this._hitsWall(eyePos.x, midY, eyePos.z, slideZ)) return slideZ

    return new THREE.Vector3()
  }

  _hitsWall(x, y, z, move) {
    const len = move.length()
    if (len < 1e-8) return false
    this._raycaster.set(new THREE.Vector3(x, y, z), move.clone().divideScalar(len))
    this._raycaster.far = PLAYER_RADIUS + len
    return this._raycaster.intersectObjects(this._allMeshes(), false).length > 0
  }

  // Cast a ray from `from` to `to`; if a wall is hit, return a point just
  // before the surface so the camera never crosses it.
  clampCameraPosition(from, to) {
    const dir  = new THREE.Vector3().subVectors(to, from)
    const dist = dir.length()
    if (dist < 1e-4) return to.clone()
    dir.divideScalar(dist)
    this._raycaster.set(from, dir)
    this._raycaster.far = dist
    const hits = this._raycaster.intersectObjects(this._allMeshes(), false)
    if (hits.length === 0) return to.clone()
    return from.clone().addScaledVector(dir, Math.max(0, hits[0].distance - 0.05))
  }

  _findFloor(x, feetY, z) {
    this._raycaster.set(
      new THREE.Vector3(x, feetY + STEP_HEIGHT, z),
      new THREE.Vector3(0, -1, 0),
    )
    this._raycaster.far = STEP_HEIGHT * 2
    const hits = this._raycaster.intersectObjects(this._allMeshes(), false)
    if (hits.length === 0) return { floorY: feetY, grounded: false }
    return { floorY: hits[0].point.y, grounded: true }
  }
}
