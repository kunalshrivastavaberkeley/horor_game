import * as THREE from 'three'
import { GameStateMachine } from './GameStateMachine/index.js'
import { SceneManagement } from './systems/SceneManagement.js'
import { PlayerController } from './systems/PlayerController.js'
import { ZoneSystem } from './systems/ZoneSystem.js'
import { ZoneEditor } from './systems/ZoneEditor.js'
import { SanitySystem } from './systems/SanitySystem.js'
import { AudioManager } from './systems/AudioManager.js'
import { LightingSystem } from './systems/LightingSystem.js'
import { EnemySystem } from './systems/EnemySystem.js'
import { TriggerSystem } from './systems/TriggerSystem.js'
import { PostProcessing } from './systems/PostProcessing.js'

const FOOTSTEP_INTERVAL = 0.45

const EXIT_BOX = new THREE.Box3(
  new THREE.Vector3(70, -2, -15),
  new THREE.Vector3(90, 10,  15)
)

async function main() {
  const gsm = new GameStateMachine()

  const audioManager = new AudioManager()
  audioManager.preload()
  gsm.registerSystem('audio', audioManager)

  const zoneSystem = new ZoneSystem()

  let sceneReadyResolve
  const sceneReady = new Promise(r => { sceneReadyResolve = r })
  const sceneManagement = new SceneManagement(gsm.scene, sceneReadyResolve)
  gsm.registerSystem('scene', sceneManagement)
  sceneManagement.loadStub()

  await Promise.all([zoneSystem.load(), sceneReady])

  const playerController = new PlayerController(sceneManagement, gsm)
  gsm.registerSystem('player', playerController)

  const sanitySystem = new SanitySystem(gsm)
  gsm.registerSystem('sanity', sanitySystem)

  const lightingSystem = new LightingSystem(gsm.scene, gsm)
  lightingSystem.init(zoneSystem.zones)
  gsm.registerSystem('lighting', lightingSystem)

  const enemySystem = new EnemySystem(gsm.scene, sceneManagement, gsm)
  enemySystem.init()
  gsm.registerSystem('enemy', enemySystem)

  const triggerSystem = new TriggerSystem()
  triggerSystem.registerTrigger(EXIT_BOX, () => gsm.onExitReached(), 'exit')

  const postProcessing = new PostProcessing(gsm.renderer, gsm.scene, gsm.camera, gsm)
  postProcessing.setPlayerController(playerController)
  gsm.setPostProcessing(postProcessing)

  const zoneEditor = new ZoneEditor(gsm.renderer, gsm.scene)   // zero-cost when DEV_MODE=false

  playerController.onNikoStateChange = (state) => {
    sanitySystem.onNikoStateChange(state)
    postProcessing.onNikoStateChange(state, playerController.nikoPosition)
    if (state === 'hugging')    audioManager.playNikoHug()
    else if (state === 'held')  audioManager.playNikoPutdown()
  }

  playerController.onArtifactPickedUp = () => {
    enemySystem.onArtifactPickedUp()
    audioManager.playUIButton()
  }

  playerController.onPause = () => gsm.onPause()

  zoneSystem.onDarknessChange = (isDark) => sanitySystem.onDarknessChange(isDark)

  zoneSystem.onSceneZoneChange = (zone) => {
    lightingSystem.onSceneZoneChange(zone)
    playerController.setZone(zone)
  }

  enemySystem.onEnemyProximityChange = (factor) => sanitySystem.onEnemyProximityChange(factor)

  let footstepTimer = 0

  const coordinator = {
    update(delta) {
      if (!gsm.isActive) return
      const pos = playerController.playerPosition

      zoneSystem.update(pos)
      triggerSystem.update(pos)

      enemySystem.setPlayerPosition(pos)
      enemySystem.setPlayerLightLevel(zoneSystem.getPlayerLightLevel(pos.x, pos.z))

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

  console.log('[main] All systems initialized — starting game')
  gsm.start()
}

main().catch(err => {
  console.error('[main] Initialization failed:', err)
})
