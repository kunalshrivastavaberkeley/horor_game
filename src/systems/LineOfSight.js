import * as THREE from 'three'

/**
 * Stateless utility. Single job: can snake see Niko light?
 */
export class LineOfSight {
  /**
   * @param {THREE.Object3D|null} catacombMesh
   */
  constructor(catacombMesh) {
    this._catacombMesh = catacombMesh
    this._raycaster = new THREE.Raycaster()
  }

  /**
   * @param {THREE.Vector3} snakeHeadPosition
   * @param {THREE.Vector3} nikoLightPosition - player camera world position
   * @param {THREE.Object3D} [snakeMesh] - root of snake mesh, excluded from self-hit
   * @returns {boolean} true if snake can see Niko light (no geometry between them)
   */
  check(snakeHeadPosition, nikoLightPosition, snakeMesh) {
    const dir = new THREE.Vector3()
      .subVectors(nikoLightPosition, snakeHeadPosition)
      .normalize()
    const dist = snakeHeadPosition.distanceTo(nikoLightPosition)

    this._raycaster.set(snakeHeadPosition, dir)
    this._raycaster.far = dist

    const meshes = [this._catacombMesh].filter(Boolean)
    const hits = this._raycaster.intersectObjects(meshes, true)

    if (!snakeMesh || hits.length === 0) return hits.length === 0

    // Collect all snake descendants to exclude self-hits at any depth
    const snakeObjects = new Set()
    snakeMesh.traverse(obj => snakeObjects.add(obj))

    const filtered = hits.filter(h => !snakeObjects.has(h.object))
    return filtered.length === 0
  }
}
