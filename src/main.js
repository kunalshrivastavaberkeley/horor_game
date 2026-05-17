import { GameStateMachine } from './GameStateMachine/index.js'
import { SceneManagement } from './systems/SceneManagement.js'

const gsm = new GameStateMachine()

const sceneManagement = new SceneManagement(gsm.scene, () => {
  console.log('[Scene] ready — starting game')
  gsm.start()
})

gsm.registerSystem('scene', sceneManagement)
sceneManagement.loadStub()
