import * as THREE from 'three'
import { GLTFLoader }      from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GameStateMachine } from './GameStateMachine/index.js'
import { SceneManagement }  from './systems/SceneManagement.js'
import { PlayerController } from './systems/PlayerController.js'
import { ZoneSystem }       from './systems/ZoneSystem.js'
import { ZoneEditor }       from './systems/ZoneEditor.js'
import { MapEditor }        from './systems/MapEditor.js'
import { ModeManager }      from './systems/ModeManager.js'
import { PlayerWalkMode }   from './systems/modes/PlayerWalkMode.js'
import { DevWalkMode }      from './systems/modes/DevWalkMode.js'
import { FlyMode }          from './systems/modes/FlyMode.js'
import { ZoneEditMode }     from './systems/modes/ZoneEditMode.js'
import { OrbitMode }        from './systems/modes/OrbitMode.js'
import { SanitySystem }     from './systems/SanitySystem.js'
import { AudioManager }     from './systems/AudioManager.js'
import { LightingSystem }   from './systems/LightingSystem.js'
import { EnemySystem }      from './systems/EnemySystem.js'
import { TriggerSystem }    from './systems/TriggerSystem.js'
import { PostProcessing }   from './systems/PostProcessing.js'
import { FogSystem }        from './systems/FogSystem.js'
import { DustParticleSystem } from './systems/DustParticleSystem.js'
import { TagSystem }        from './systems/TagSystem.js'
import { SpatialSystem }    from './systems/SpatialSystem.js'
import { NIKO }             from './nikoConfig.js'

const FOOTSTEP_INTERVAL = 0.45

const EXIT_BOX = new THREE.Box3(
  new THREE.Vector3(70, -2, -15),
  new THREE.Vector3(90, 10,  15)
)

async function main() {
  const gsm = new GameStateMachine()

  // ─── Audio ───────────────────────────────────────────────────────────────────
  const audioManager = new AudioManager()
  audioManager.preload()
  gsm.registerSystem('audio', audioManager)

  // ─── Scene + zones (await before anything touches the mesh) ──────────────────
  const zoneSystem = new ZoneSystem()

  let sceneReadyResolve
  const sceneReady     = new Promise(r => { sceneReadyResolve = r })
  const sceneManagement = new SceneManagement(gsm.scene, sceneReadyResolve)
  gsm.registerSystem('scene', sceneManagement)
  sceneManagement.loadCatacomb('/models/catacomb.glb')

  await Promise.all([zoneSystem.load(), sceneReady])

  sceneManagement.setCatacombStoneAppearance(0x000000, 0)

  // Pass 3 — fog: height-based pooling at floor + animated FBM noise drift.
  // Must run after setCatacombStoneAppearance so it patches the finalized materials.
  const fogSystem = new FogSystem(gsm.scene, gsm)
  fogSystem.applyFogToMesh(sceneManagement.getCatacombMesh())
  gsm.registerSystem('fog', fogSystem)

  // ─── Player entity ───────────────────────────────────────────────────────────
  const playerController = new PlayerController(sceneManagement, gsm)
  gsm.registerSystem('player', playerController)

  let _nikoScene = null
  let _bulbScene = null

  function _attachBulbToNiko() {
    _bulbScene.scale.setScalar(NIKO.bulbScale)
    _bulbScene.position.set(NIKO.bulbX, NIKO.bulbY, NIKO.bulbZ)
    _nikoScene.add(_bulbScene)
    lightingSystem.setBulbMesh(_bulbScene)
  }

  const nikoLoader = new GLTFLoader()
  nikoLoader.load(
    '/models/niko.glb',
    (gltf) => {
      gltf.scene.traverse(o => {
        if (o.isMesh) o.renderOrder = 2
      })
      gsm.scene.add(gltf.scene)
      playerController.setNikoMesh(gltf.scene)
      lightingSystem.setNikoMesh(gltf.scene)
      _nikoScene = gltf.scene
      if (_bulbScene) _attachBulbToNiko()
    },
    undefined,
    (err) => console.error('[main] Niko load failed:', err)
  )

  // ─── Hand billboard — fingers BEHIND Niko, thumb IN FRONT ───────────────────
  // Render order sandwich: sentinel clears depth (1) → Niko (2) → fingers (3) → thumb (4)
  // The sentinel fires renderer.clearDepth() so Niko always draws in front of walls
  // but still self-occludes correctly (depthTest stays ON for Niko's own meshes).
  const _sentinel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.001, 0.001),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: false, depthWrite: false })
  )
  _sentinel.renderOrder = 1
  _sentinel.frustumCulled = false
  _sentinel.onBeforeRender = (renderer) => renderer.clearDepth()
  gsm.scene.add(_sentinel)

  const texLoader = new THREE.TextureLoader()

  // fingers: renderOrder 3 — drawn after Niko (2) with depthTest ON → Niko's depth occludes it → behind Niko.
  const fingersSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texLoader.load('/fingers.png'), transparent: true, depthTest: true, depthWrite: false })
  )
  fingersSprite.renderOrder = 3
  fingersSprite.visible = false
  gsm.scene.add(fingersSprite)

  // thumb: renderOrder 4 — drawn last, depthTest OFF → always in front of everything.
  const thumbSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texLoader.load('/thumb_1.png'), transparent: true, depthTest: false, depthWrite: false })
  )
  thumbSprite.renderOrder = 4
  thumbSprite.visible = false
  gsm.scene.add(thumbSprite)

  playerController.setHandSprites(thumbSprite, fingersSprite)

  const bulbLoader = new GLTFLoader()
  bulbLoader.load(
    '/models/the_sun_from_oneshot.glb',
    (gltf) => {
      console.log('[main] Bulb loaded:', gltf.scene)
      let meshCount = 0
      gltf.scene.traverse(o => { if (o.isMesh) { console.log('[main] Bulb mesh:', o.name, 'mat:', o.material?.type); meshCount++ } })
      console.log('[main] Bulb mesh count:', meshCount)
      _bulbScene = gltf.scene
      if (_nikoScene) _attachBulbToNiko()
    },
    undefined,
    (err) => console.error('[main] Bulb load failed:', err)
  )

  // ─── Game systems ─────────────────────────────────────────────────────────────
  const sanitySystem = new SanitySystem(gsm)
  gsm.registerSystem('sanity', sanitySystem)

  const lightingSystem = new LightingSystem(gsm.scene, gsm)
  lightingSystem.init(zoneSystem.zones)
  gsm.registerSystem('lighting', lightingSystem)

  const dustSystem = new DustParticleSystem(gsm.scene, gsm)
  dustSystem.setNikoLight(lightingSystem.getNikoLight())
  dustSystem.setCatacombMesh(sceneManagement.getCatacombMesh())
  gsm.registerSystem('dust', dustSystem)

  const enemySystem = new EnemySystem(gsm.scene)
  enemySystem.init()
  gsm.registerSystem('enemy', enemySystem)

  const triggerSystem = new TriggerSystem()
  triggerSystem.registerTrigger(EXIT_BOX, () => gsm.onExitReached(), 'exit')

  const postProcessing = new PostProcessing(gsm.renderer, gsm.scene, gsm.camera, gsm)
  gsm.setPostProcessing(postProcessing)
  gsm.registerSystem('postProcessing', postProcessing)

  // ─── Dev tools ───────────────────────────────────────────────────────────────
  const zoneEditor = new ZoneEditor(gsm.scene)
  await zoneEditor.load()

  const tagSystem = new TagSystem(gsm.scene)
  await tagSystem.load()

  const spatialSystem = new SpatialSystem(gsm.scene)
  await spatialSystem.load()

  const mapEditor = new MapEditor(gsm.scene, gsm.renderer, sceneManagement)
  mapEditor.onWallsChanged = () => {
    playerController.collision?.setExtraWallMeshes(mapEditor.getWallMeshes())
  }

  // ─── Mode setup ───────────────────────────────────────────────────────────────
  const modeManager = new ModeManager(gsm.renderer)

  const playerWalkMode = new PlayerWalkMode(gsm.camera, playerController, gsm.renderer, gsm, modeManager, tagSystem)
  const devWalkMode    = new DevWalkMode(gsm.camera, playerController, gsm.renderer, gsm, modeManager, zoneEditor, lightingSystem, tagSystem, sceneManagement, spatialSystem)
  const flyMode        = new FlyMode(gsm.renderer, playerController, lightingSystem, modeManager, gsm.scene)
  const zoneEditMode   = new ZoneEditMode(gsm.renderer, gsm.scene, zoneEditor, lightingSystem, tagSystem)
  const orbitMode      = new OrbitMode(mapEditor)

  modeManager.register('playerWalk', playerWalkMode)
  modeManager.register('devWalk',    devWalkMode)
  modeManager.register('fly',        flyMode)
  modeManager.register('zoneEdit',   zoneEditMode)
  modeManager.register('orbit',      orbitMode)
  modeManager.start('playerWalk')

  gsm.setModeManager(modeManager)
  gsm.setMinimap(zoneEditor.camera)
  gsm.registerSystem('modeManager', modeManager)

  // ─── Minimap markers ─────────────────────────────────────────────────────────
  const playerMarker = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide })
  )
  playerMarker.rotation.x = -Math.PI / 2
  playerMarker.visible = false
  gsm.scene.add(playerMarker)

  const flyMarker = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  )
  flyMarker.rotation.x = -Math.PI / 2
  flyMarker.visible = false
  gsm.scene.add(flyMarker)

  // ─── Cross-system callbacks ───────────────────────────────────────────────────
  playerController.onNikoStateChange = (state) => {
    sanitySystem.onNikoStateChange(state)
    if (state === 'hugging')   audioManager.playNikoHug()
    else if (state === 'held') audioManager.playNikoPutdown()
  }

  playerController.onArtifactPickedUp = () => {
    enemySystem.onArtifactPickedUp()
    audioManager.playUIButton()
  }

  playerController.onPause = () => gsm.onPause()

  zoneSystem.onDarknessChange = (isDark) => sanitySystem.onDarknessChange(isDark)

  enemySystem.onStageChange = (_stage) => { /* PresenceSystem receives this */ }

  // ─── Coordinator ─────────────────────────────────────────────────────────────
  let footstepTimer = 0

  const coordinator = {
    update(delta) {
      mapEditor.update()
      if (!gsm.isActive) return

      const pos   = playerController.playerPosition
      const inFly = modeManager.activeKey === 'fly'

      playerMarker.position.set(pos.x, 80, pos.z)
      playerMarker.visible = inFly

      flyMarker.position.set(flyMode.camera.position.x, 80, flyMode.camera.position.z)
      flyMarker.visible = inFly

      playerController.setBodyVisible(inFly)

      sanitySystem.setLightRatio(dustSystem.getLightRatio())

      zoneSystem.update(pos)
      triggerSystem.update(pos)

      enemySystem.setPlayerPosition(pos)
      enemySystem.setPlayerLightLevel(zoneSystem.getPlayerLightLevel(pos.x, pos.z))
      enemySystem.updateGodHelpers(inFly)

      audioManager.onSanityChange(sanitySystem.getSanity())

      if (playerController.movementState === 'walking') {
        footstepTimer -= delta
        if (footstepTimer <= 0) {
          audioManager.playFootstep()
          footstepTimer = FOOTSTEP_INTERVAL
        }
      } else {
        footstepTimer = 0
      }
    }
  }
  gsm.registerSystem('coordinator', coordinator)

  // ─── Negative-emission skull test ────────────────────────────────────────────
  let negSphere = null
  const skullLoader = new GLTFLoader()
  skullLoader.load(
    '/models/skull_downloadable.glb',
    (gltf) => {
      negSphere = gltf.scene
      const negMat = new THREE.MeshStandardMaterial({
        color:             0x000000,
        emissive:          new THREE.Color(1, 1, 1),
        emissiveIntensity: 0.1,
        blending:          THREE.SubtractiveBlending,
        depthWrite:        false,
      })
      negSphere.traverse(child => { if (child.isMesh) child.material = negMat })
      negSphere.position.set(-53.0, 4, -30)
      negSphere.rotation.y = -Math.PI / 2
      negSphere.scale.setScalar(0.3)
      gsm.scene.add(negSphere)
      dustSystem.setMonster(negSphere)
    },
    undefined,
    (err) => console.error('[main] Skull load failed:', err)
  )

  const testLight = new THREE.PointLight(0xffffff, 8, 6)
  testLight.position.set(-53.0, 4, -30)
  gsm.scene.add(testLight)

  gsm.camera.position.copy(playerController.playerPosition)

  console.log('[main] All systems initialized — starting game')
  gsm.start()
}

main().catch(err => console.error('[main] Initialization failed:', err))
