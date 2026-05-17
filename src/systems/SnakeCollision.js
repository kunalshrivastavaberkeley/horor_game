import * as THREE from 'three'

// Tunable constants
const TRANSITION_ANGLE_THRESHOLD = Math.PI / 3  // ~60 degrees
const TRANSITION_LERP_RATE = 0.05               // per frame
const RAYCAST_DISTANCE = 2.0

const DIRECTIONS = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
]

export class SnakeCollision {
  constructor(templeMesh, desertMesh) {
    this._templeMesh = templeMesh
    this._desertMesh = desertMesh
    this._raycaster = new THREE.Raycaster()

    /** @type {THREE.Vector3} The normal of the surface the snake is currently on */
    this.currentSurfaceNormal = new THREE.Vector3(0, 1, 0)

    /** @type {Array<{dir: THREE.Vector3, distance: number, normal: THREE.Vector3}>} */
    this.nearestSurfaces = []

    /** @type {boolean} True when a surface-type transition is approaching */
    this.approachingTransition = false

    /** @type {THREE.Vector3} Normal of the incoming surface if transition detected */
    this.targetTransitionNormal = new THREE.Vector3(0, 1, 0)
  }

  /**
   * Update collision state for this frame.
   * @param {THREE.Vector3} snakePosition
   * @param {THREE.Vector3} snakeForward - normalized forward direction
   */
  update(snakePosition, snakeForward) {
    const meshes = [this._templeMesh, this._desertMesh].filter(Boolean)
    this.nearestSurfaces = []

    for (const dir of DIRECTIONS) {
      this._raycaster.set(snakePosition, dir)
      this._raycaster.far = RAYCAST_DISTANCE
      const hits = this._raycaster.intersectObjects(meshes, true)
      if (hits.length > 0) {
        const h = hits[0]
        // face.normal is in object space — convert to world space
        const worldNormal = h.face.normal.clone().transformDirection(h.object.matrixWorld)
        this.nearestSurfaces.push({ dir: dir.clone(), distance: h.distance, normal: worldNormal })
      }
    }

    // Update surface normal from the "downward" ray (opposite to local up)
    // Local up = currentSurfaceNormal, so "down" is the one most aligned with -currentSurfaceNormal
    const downHit = this.nearestSurfaces.reduce((best, s) => {
      const align = -s.dir.dot(this.currentSurfaceNormal)
      return (!best || align > -best.dir.dot(this.currentSurfaceNormal)) ? s : best
    }, null)

    if (downHit) {
      this.currentSurfaceNormal.lerp(downHit.normal, TRANSITION_LERP_RATE).normalize()
    }

    // Detect transition ahead
    const fwdHit = this.nearestSurfaces.find(s => s.dir.dot(snakeForward) > 0.5)
    if (fwdHit) {
      const delta = this.currentSurfaceNormal.angleTo(fwdHit.normal)
      this.approachingTransition = delta > TRANSITION_ANGLE_THRESHOLD
      if (this.approachingTransition) {
        this.targetTransitionNormal.copy(fwdHit.normal)
      }
    } else {
      this.approachingTransition = false
    }
  }
}
