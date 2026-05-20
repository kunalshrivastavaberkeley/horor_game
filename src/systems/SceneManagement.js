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

  setCatacombStoneAppearance(emissiveColor = 0x000000, emissiveIntensity = 0) {
    this._assertReady('setCatacombStoneAppearance')
    this._catacombMesh.traverse(child => {
      if (!child.isMesh) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (let i = 0; i < mats.length; i++) {
        const old = mats[i]
        const stone = new THREE.MeshStandardMaterial({
          map:              old.map              ?? null,
          normalMap:        old.normalMap        ?? null,
          aoMap:            old.aoMap            ?? null,
          roughnessMap:     old.roughnessMap     ?? null,
          metalnessMap:     old.metalnessMap     ?? null,
          color:            old.color            ?? new THREE.Color(0x8a7060),
          roughness:        0.92,
          metalness:        0.0,
          side:             old.side             ?? THREE.FrontSide,
          transparent:      old.transparent      ?? false,
          opacity:          old.opacity          ?? 1.0,
          alphaTest:        old.alphaTest        ?? 0,
          name:             old.name             ?? '',
          emissive:         new THREE.Color(emissiveColor),
          emissiveIntensity,
        })
        if (Array.isArray(child.material)) child.material[i] = stone
        else child.material = stone
        old.dispose()
      }
    })
  }

  /**
   * Pass 2 — overlay each catacomb mesh with a SubtractiveBlending ghost.
   * The warm emissive color gets subtracted from the rendered frame wherever the
   * stone sits, making walls drain warmth out of the scene. Niko's additive point
   * light still wins in open space — the effect reads as the stone "eating" light.
   * @param {number|THREE.Color} color      warm color to subtract, e.g. 0xff5500
   * @param {number}             intensity  strength of the drain
   */
  addCatacombSubtractiveOverlay(color = 0xff5500, intensity = 0.35) {
    this._assertReady('addCatacombSubtractiveOverlay')

    // Shared material — same for all overlay meshes, no per-mesh state needed
    const overlayMat = new THREE.MeshStandardMaterial({
      color:             0x000000,
      emissive:          new THREE.Color(color),
      emissiveIntensity: intensity,
      blending:          THREE.SubtractiveBlending,
      depthWrite:        false,
      depthTest:         true,
      transparent:       true,
      fog:               true,
    })

    // Collect meshes first so traverse doesn't see the new overlays
    const meshes = []
    this._catacombMesh.traverse(child => { if (child.isMesh) meshes.push(child) })

    const overlays = []
    for (const child of meshes) {
      const overlay = new THREE.Mesh(child.geometry, overlayMat)
      overlay.renderOrder = 1
      // Bake world transform so overlays sit exactly on top of the stone
      child.updateWorldMatrix(true, false)
      overlay.applyMatrix4(child.matrixWorld)
      overlay.matrixAutoUpdate = false
      this._scene.add(overlay)
      overlays.push(overlay)
    }
    this._catacombOverlays = overlays
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
