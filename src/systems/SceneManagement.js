import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'

// Tunable constants
const DESERT_POSITION = new THREE.Vector3(0, 0, 0)
const TEMPLE_POSITION = new THREE.Vector3(50, 0, 0)
const ARTIFACT_DEFAULT_POSITION = new THREE.Vector3(55, 1, 0)
const DESERT_PHYSICS_MASS = 0
const TEMPLE_PHYSICS_MASS = 0

export class SceneManagement {
  constructor(scene, onSceneReady) {
    this._scene = scene
    this._onSceneReady = onSceneReady
    this._ready = false

    this._physicsWorld = new CANNON.World()
    this._physicsWorld.gravity.set(0, -9.82, 0)
    this._physicsWorld.broadphase = new CANNON.NaiveBroadphase()

    this._desertMesh = null
    this._templeMesh = null
    this._artifactPosition = ARTIFACT_DEFAULT_POSITION.clone()
  }

  /**
   * Load real GLTF assets — use when assets are available.
   */
  load(desertPath, templePath) {
    const loader = new GLTFLoader()
    let desertLoaded = false
    let templeLoaded = false

    const checkReady = () => {
      if (desertLoaded && templeLoaded) {
        this._ready = true
        this._onSceneReady()
      }
    }

    loader.load(
      desertPath,
      (gltf) => {
        this._desertMesh = gltf.scene
        this._desertMesh.position.copy(DESERT_POSITION)
        this._scene.add(this._desertMesh)
        this._buildDesertPhysics()
        desertLoaded = true
        checkReady()
      },
      undefined,
      (err) => {
        console.error('[SceneManagement] Desert load failed:', err)
        this._onSceneError('desert', err)
      }
    )

    loader.load(
      templePath,
      (gltf) => {
        this._templeMesh = gltf.scene
        this._templeMesh.position.copy(TEMPLE_POSITION)
        this._scene.add(this._templeMesh)
        this._buildTemplePhysics(gltf)
        templeLoaded = true
        checkReady()
      },
      undefined,
      (err) => {
        console.error('[SceneManagement] Temple load failed:', err)
        this._onSceneError('temple', err)
      }
    )
  }

  /**
   * Stub loader — creates placeholder geometry for dev when no GLTF assets exist.
   * Fires onSceneReady synchronously.
   */
  loadStub() {
    // Desert: flat ground plane
    const desertGeo = new THREE.PlaneGeometry(200, 200)
    const desertMat = new THREE.MeshStandardMaterial({ color: 0x998866 })
    this._desertMesh = new THREE.Mesh(desertGeo, desertMat)
    this._desertMesh.rotation.x = -Math.PI / 2
    this._desertMesh.position.copy(DESERT_POSITION)
    this._scene.add(this._desertMesh)

    // Temple: box placeholder
    const templeGeo = new THREE.BoxGeometry(30, 8, 30)
    const templeMat = new THREE.MeshStandardMaterial({ color: 0x554433, side: THREE.BackSide })
    this._templeMesh = new THREE.Mesh(templeGeo, templeMat)
    this._templeMesh.position.copy(TEMPLE_POSITION).add(new THREE.Vector3(0, 4, 0))
    this._scene.add(this._templeMesh)

    // Physics — ground plane for desert
    this._buildDesertPhysics()

    this._ready = true
    this._onSceneReady()
  }

  _buildDesertPhysics() {
    const body = new CANNON.Body({ mass: DESERT_PHYSICS_MASS })
    body.addShape(new CANNON.Plane())
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this._physicsWorld.addBody(body)
  }

  _buildTemplePhysics(gltf) {
    // Build trimesh physics from GLTF geometry
    // Decision: only process first indexed mesh found — non-indexed meshes skipped (uncommon in GLTFs)
    gltf.scene.traverse(child => {
      if (!child.isMesh || !child.geometry) return
      const geo = child.geometry
      if (!geo.index) return // skip non-indexed

      const pos = geo.attributes.position.array
      const idx = geo.index.array
      const shape = new CANNON.Trimesh(Array.from(pos), Array.from(idx))
      const body = new CANNON.Body({ mass: TEMPLE_PHYSICS_MASS })
      body.addShape(shape)
      body.position.set(TEMPLE_POSITION.x, TEMPLE_POSITION.y, TEMPLE_POSITION.z)
      this._physicsWorld.addBody(body)
    })
  }

  _onSceneError(assetName, err) {
    // Decision: log clearly and block transition — do not silently hang
    console.error(`[SceneManagement] FATAL: ${assetName} asset failed to load. Game cannot start.`, err)
    // Show user-facing error message
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

  getScene()        { this._assertReady('getScene');        return this._scene }
  getPhysicsWorld() { this._assertReady('getPhysicsWorld'); return this._physicsWorld }
  getDesertMesh()   { this._assertReady('getDesertMesh');   return this._desertMesh }
  getTempleMesh()   { this._assertReady('getTempleMesh');   return this._templeMesh }
  getArtifactPosition() { return this._artifactPosition }

  update(delta) {
    if (!this._ready) return
    this._physicsWorld.step(1 / 60, delta, 3)
  }
}
