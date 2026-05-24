import * as THREE from 'three'
import { GLTFLoader }        from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PanelManager }      from './systems/PanelManager.js'
import { GameStateMachine }  from './GameStateMachine/index.js'
import { SceneManagement }   from './systems/SceneManagement.js'
import { PlayerController }  from './systems/PlayerController.js'
import { MapEditor }         from './systems/MapEditor.js'
import { AudioManager }      from './systems/AudioManager.js'
import { LightingSystem }    from './systems/LightingSystem.js'
import { EnemySystem }       from './systems/EnemySystem.js'
import { TriggerSystem }     from './systems/TriggerSystem.js'
import { TagSystem }         from './systems/TagSystem.js'
import { SpatialSystem }     from './systems/SpatialSystem.js'
import { PostProcessing }    from './systems/PostProcessing.js'
import { IntroSequence }     from './systems/IntroSequence.js'
import { CutscenePlayer }    from './systems/CutscenePlayer.js'
import { PathRecorder }      from './systems/PathRecorder.js'
import GameSettings          from '../data/settings.json'
import { CameraController }  from './systems/CameraController.js'
import { SettingsPanel }     from './systems/SettingsPanel.js'
import { PresetManager }     from './systems/PresetManager.js'
import { DevEditor }         from './systems/DevEditor.js'
import { ScenePanel }        from './systems/ScenePanel.js'
import { wireSettings }      from './systems/settingsWiring.js'


const EXIT_BOX = new THREE.Box3(
  new THREE.Vector3(70, -2, -15),
  new THREE.Vector3(90, 10,  15)
)

async function main() {
  const panelManager = new PanelManager()
  const gsm = new GameStateMachine(panelManager.getContainer('viewport'))

  // ─── Audio ───────────────────────────────────────────────────────────────────
  const audioManager = new AudioManager()
  audioManager.preload()
  gsm.registerSystem('audio', audioManager)

  // ─── Scene ───────────────────────────────────────────────────────────────────
  let sceneReadyResolve
  const sceneReady      = new Promise(r => { sceneReadyResolve = r })
  const sceneManagement = new SceneManagement(gsm.scene, sceneReadyResolve)
  gsm.registerSystem('scene', sceneManagement)
  sceneManagement.loadCatacomb('/models/AO.glb')

  await sceneReady
  sceneManagement.setCatacombStoneAppearance(0x000000, 0)

  // ─── Player entity ───────────────────────────────────────────────────────────
  const playerController = new PlayerController(sceneManagement, gsm)
  gsm.registerSystem('player', playerController)

  // ─── Game systems ─────────────────────────────────────────────────────────────
  const lightingSystem = new LightingSystem(gsm.scene, gsm, gsm.renderer)
  lightingSystem.init()
  lightingSystem.applyLanternToScene()
  gsm.registerSystem('lighting', lightingSystem)

  // ─── Niko lantern model ───────────────────────────────────────────────────────
  new GLTFLoader().load(
    '/models/niko.glb',
    (gltf) => {
      gltf.scene.traverse(o => {
        if (!o.isMesh) return
        o.renderOrder = 2

        // Swap to MeshPhysicalMaterial so the lantern shader injection works
        // and Niko responds to PBR lighting correctly
        const old = o.material
        o.material = new THREE.MeshPhysicalMaterial({
          map:          old.map          ?? null,
          normalMap:    old.normalMap    ?? null,
          roughnessMap: old.roughnessMap ?? null,
          metalnessMap: old.metalnessMap ?? null,
          aoMap:        old.aoMap        ?? null,
          color:        old.color        ?? new THREE.Color(0xffffff),
          roughness:    old.roughness    ?? 1.0,
          metalness:    old.metalness    ?? 0.0,
          transparent:  old.transparent  ?? false,
          opacity:      old.opacity      ?? 1.0,
          side:         old.side         ?? THREE.FrontSide,
          alphaTest:    old.alphaTest    ?? 0,
        })
        old.dispose()
      })

      gsm.scene.add(gltf.scene)
      playerController.setLanternMesh(gltf.scene)
      lightingSystem.setLanternMesh(gltf.scene)
      // Inject lantern shader into Niko's new MeshPhysicalMaterial instances
      lightingSystem.applyLanternToScene()
    },
    undefined,
    (err) => console.error('[main] Niko load failed:', err)
  )

  const enemySystem = new EnemySystem(gsm.scene)
  enemySystem.init()
  gsm.registerSystem('enemy', enemySystem)

  const triggerSystem = new TriggerSystem()
  triggerSystem.registerTrigger(EXIT_BOX, () => gsm.onExitReached(), 'exit')

  // ─── Dev tools ───────────────────────────────────────────────────────────────
  const tagSystem = new TagSystem(gsm.scene)
  await tagSystem.load()

  const spatialSystem = new SpatialSystem(gsm.scene)
  await spatialSystem.load()

  const mapEditor = new MapEditor(gsm.scene, gsm.renderer, sceneManagement)
  mapEditor.onWallsChanged = () => {
    playerController.collision?.setExtraWallMeshes(mapEditor.getWallMeshes())
  }

  // ─── Camera paths (created early so settingsWiring can reference it) ─────────
  const pathRecorder = new PathRecorder('intro', gsm.scene, gsm)

  // ─── Settings + panel ─────────────────────────────────────────────────────────
  const presetManager = new PresetManager()
  const panel         = new SettingsPanel(presetManager, panelManager.getContainer('settings'))
  gsm.registerSystem('settings', GameSettings)   // render loop reads settings.minimap

  // ─── Camera controller ────────────────────────────────────────────────────────
  const cameraController = new CameraController(
    gsm.camera, playerController, GameSettings, gsm.renderer, gsm.scene
  )
  gsm.registerSystem('cameraController', cameraController)
  gsm.setCameraController(cameraController)

  // Standalone top-down orthographic camera for minimap
  const _minimapCam = (() => {
    const frustum = 50
    const vEl     = gsm._viewportEl
    const aspect  = (vEl.clientWidth || window.innerWidth) / (vEl.clientHeight || window.innerHeight)
    const cam = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 1000
    )
    cam.position.set(0, 100, 0)
    cam.lookAt(0, 0, 0)
    cam.up.set(0, 0, -1)
    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (!width || !height) return
      const a = width / height
      cam.left = -frustum * a; cam.right = frustum * a
      cam.updateProjectionMatrix()
    }).observe(vEl)
    return cam
  })()
  gsm.setMinimap(_minimapCam)

  // Register focusable providers for examine mode
  cameraController.registerFocusableProvider(spatialSystem)
  cameraController.registerFocusableProvider(tagSystem)

  // ─── Dev editor (graph + tag editing tools) ───────────────────────────────────
  const devEditor = new DevEditor(
    cameraController, GameSettings, spatialSystem, tagSystem, sceneManagement, gsm
  )

  // ─── Scene panel ─────────────────────────────────────────────────────────────
  const scenePanel = new ScenePanel(spatialSystem, tagSystem, cameraController, panelManager.getContainer('scene'))
  devEditor.onDataChanged = () => scenePanel.refresh()

  // ─── Post-processing ─────────────────────────────────────────────────────────
  const postProcessing = new PostProcessing(gsm.renderer, gsm.scene, gsm.camera)
  gsm.registerSystem('postProcessing', postProcessing)

  // ─── Boot sequence ────────────────────────────────────────────────────────────
  // 1. Give the preset manager references to the systems it needs for exit behaviors
  presetManager.init({ cameraController, playerController })

  // 2. Wire the settings panel to system handlers so changes propagate
  wireSettings(panel, {
    GameSettings,
    cameraController,
    playerController,
    lightingSystem,
    spatialSystem,
    tagSystem,
    postProcessing,
    pathRecorder,
    sceneManagement,
    gsm,
  })
  panel.buildPathManager(pathRecorder)

  // 3. Enter Play — writes Play settings into GameSettings
  presetManager.activate('Play')

  // 4. Push current GameSettings to all systems and sync the panel UI
  panel.applyAll()

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
  playerController.onLanternStateChange = (state) => {
    if (state === 'hugging')   audioManager.playLanternHug()
    else if (state === 'held') audioManager.playLanternPutdown()
  }

  playerController.onArtifactPickedUp = () => {
    enemySystem.onArtifactPickedUp()
    audioManager.playUIButton()
  }

  playerController.onPause = () => gsm.onPause()

  // ─── Coordinator ─────────────────────────────────────────────────────────────
  const coordinator = {
    update(delta) {
      mapEditor.update()
      pathRecorder.tick(delta)

      // Sync focus label in panel
      panel.updateFocusLabel(cameraController.examFocusLabel)

      // Dev editor tools (graph + tag editing)
      devEditor.update()

      if (!gsm.isActive) return

      const pos    = playerController.playerPosition
      const inFly  = cameraController.activeType === 'fly'
      const inExam = cameraController.activeType === 'orbit'

      // Minimap markers
      playerMarker.position.set(pos.x, 80, pos.z)
      playerMarker.visible = inFly && GameSettings.minimap
      if (inFly) {
        const camPos = cameraController.cameraPosition
        flyMarker.position.set(camPos.x, 80, camPos.z)
      }
      flyMarker.visible = inFly && GameSettings.minimap

      if (GameSettings.collision) triggerSystem.update(pos)

      enemySystem.setPlayerPosition(pos)
      enemySystem.updateGodHelpers(inFly || inExam)

    }
  }
  gsm.registerSystem('coordinator', coordinator)

  gsm.camera.position.copy(playerController.playerPosition)

  // ─── Camera paths ────────────────────────────────────────────────────────────
  const introPathData = await CutscenePlayer.loadPath('intro')
  if (introPathData?.waypoints?.length >= 2) {
    pathRecorder.setWaypoints(introPathData.waypoints)
  }

  // ─── Intro sequence ───────────────────────────────────────────────────────────
  gsm.introSequence = new IntroSequence(gsm, playerController, cameraController, introPathData)

  console.log('[main] All systems initialized — starting game')
  gsm.start()
}

main().catch(err => console.error('[main] Initialization failed:', err))
