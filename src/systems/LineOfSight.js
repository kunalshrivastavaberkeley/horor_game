import * as THREE from 'three'

/**
 * Stateless utility. Single job: can snake see Niko light?
 */
export class LineOfSight {
  constructor(templeMesh) {
    this._templeMesh = templeMesh
    this._raycaster = new THREE.Raycaster()
  }

  /**
   * @param {THREE.Vector3} snakeHeadPosition
   * @param {THREE.Vector3} nikoLightPosition - player camera world position
   * @param {THREE.Object3D} [snakeMesh] - excluded from raycast to prevent self-hit
   * @returns {boolean} true if snake can see Niko light
   */
  check(snakeHeadPosition, nikoLightPosition, snakeMesh) {
    const dir = new THREE.Vector3()
      .subVectors(nikoLightPosition, snakeHeadPosition)
      .normalize()
    const dist = snakeHeadPosition.distanceTo(nikoLightPosition)

    this._raycaster.set(snakeHeadPosition, dir)
    this._raycaster.far = dist

    const meshes = [this._templeMesh].filter(Boolean)
    const hits = this._raycaster.intersectObjects(meshes, true)

    // Filter out snake's own geometry if provided
    const filtered = snakeMesh
      ? hits.filter(h => !snakeMesh.children.includes(h.object) && h.object !== snakeMesh)
      : hits

    return filtered.length === 0
  }
}
