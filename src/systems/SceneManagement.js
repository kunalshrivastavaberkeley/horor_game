import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// Tunable constants
const CATACOMB_POSITION = new THREE.Vector3(0, 0, 0)
const ARTIFACT_DEFAULT_POSITION = new THREE.Vector3(5, 1, 0)

export class SceneManagement {
  constructor(scene, onSceneReady) {
    this._scene = scene
    this._onSceneReady = onSceneReady
    this._ready = false

    this._catacombMesh = null
    this._artifactPosition = ARTIFACT_DEFAULT_POSITION.clone()
  }

  /**
   * Production loader — real catacomb GLTF at world origin.
   * onSceneReady fires once the GLB finishes loading.
   * @param {string} catacombPath  URL served from public/models/
   */
  loadCatacomb(catacombPath) {
    const loader = new GLTFLoader()
    loader.load(
      catacombPath,
      (gltf) => {
        this._catacombMesh = gltf.scene
        this._catacombMesh.position.copy(CATACOMB_POSITION)
        this._scene.add(this._catacombMesh)
        this._catacombMesh.traverse(child => {
          if (child.isMesh) child.geometry.computeBoundsTree()
        })
        this._ready = true
        this._onSceneReady()
      },
      undefined,
      (err) => {
        console.error('[SceneManagement] Catacomb load failed:', err)
        this._onSceneError('catacomb', err)
      }
    )
  }

  /**
   * Stub loader — box placeholder for dev when no GLTF asset exists.
   * Fires onSceneReady synchronously.
   */
  loadStub() {
    const geo = new THREE.BoxGeometry(30, 8, 30)
    const mat = new THREE.MeshStandardMaterial({ color: 0x332211, side: THREE.BackSide })
    this._catacombMesh = new THREE.Mesh(geo, mat)
    this._catacombMesh.position.copy(CATACOMB_POSITION).add(new THREE.Vector3(0, 4, 0))
    this._scene.add(this._catacombMesh)

    this._ready = true
    this._onSceneReady()
  }

  _onSceneError(assetName, err) {
    console.error(`[SceneManagement] FATAL: ${assetName} asset failed to load. Game cannot start.`, err)
    const errDiv = document.createElement('div')
    Object.assign(errDiv.style, {
      position: 'fixed', inset: '0', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#000', color: '#f44',
      fontSize: '1.2rem', zIndex: '999', fontFamily: 'monospace', textAlign: 'center',
      padding: '2rem'
    })
    errDiv.textContent = `Asset load failed: ${assetName}. Check console for details.`
    document.body.appendChild(errDiv)
  }

  _assertReady(methodName) {
    if (!this._ready) {
      throw new Error(`[SceneManagement] ${methodName}() called before onSceneReady fired`)
    }
  }

  getScene()            { this._assertReady('getScene');         return this._scene }
  getCatacombMesh()     { this._assertReady('getCatacombMesh');  return this._catacombMesh }
  getArtifactPosition() { return this._artifactPosition }
}
