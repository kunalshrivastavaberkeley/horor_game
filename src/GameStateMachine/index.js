import * as THREE from 'three'
import { StartState }    from './flow/StartState.js'
import { IntroState }    from './flow/IntroState.js'
import { DesertState }   from './flow/DesertState.js'
import { TempleState }   from './flow/TempleState.js'
import { ExitState }     from './flow/ExitState.js'
import { EndState }      from './flow/EndState.js'
import { SettingsState } from './utilities/SettingsState.js'

const STATES = {
  START:    StartState,
  INTRO:    IntroState,
  DESERT:   DesertState,
  TEMPLE:   TempleState,
  EXIT:     ExitState,
  END:      EndState,
  SETTINGS: SettingsState,
}

export class GameStateMachine {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    document.getElementById('app').appendChild(this.renderer.domElement)

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.scene.add(this.camera)

    this.currentStateName = null
    this.currentState     = null
    this.isActive         = false

    this.systems = {}

    this._clock         = new THREE.Clock()
    this._postProcessing = null
    this._modeManager   = null    // set by main.js
    this._minimapCam    = null    // set by main.js

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      if (this._postProcessing) this._postProcessing._composer?.setSize(window.innerWidth, window.innerHeight)
    })
  }

  registerSystem(name, system) { this.systems[name] = system }

  setPostProcessing(pp)    { this._postProcessing = pp }
  setModeManager(mm)       { this._modeManager = mm }
  setMinimap(cam)          { this._minimapCam = cam }

  start() {
    this.transition('START')
    this._loop()
  }

  transition(stateName) {
    if (!STATES[stateName]) { console.error(`[GSM] Unknown state: ${stateName}`); return }
    if (this.currentState?.exit) this.currentState.exit(this)
    this.currentStateName = stateName
    this.currentState     = new STATES[stateName]()
    this.currentState.enter(this)
    console.log(`[GSM] → ${stateName}`)
  }

  setGameActive(val) { this.isActive = val }

  onSanityDepleted() { if (this.currentStateName !== 'END') this.transition('END') }
  onExitReached()    { if (this.currentStateName !== 'END') this.transition('END') }
  onPlayerCaught()   { if (this.currentStateName !== 'END') this.transition('END') }
  onPause()          { console.log('[GSM] Pause requested (pointer lock lost)') }

  _loop() {
    requestAnimationFrame(() => this._loop())
    const delta = this._clock.getDelta()

    this.currentState?.update?.(this, delta)
    for (const sys of Object.values(this.systems)) sys.update?.(delta)

    // Active camera from ModeManager, fallback to game camera
    const activeCam = this._modeManager?.activeCamera ?? this.camera

    // Minimap sub-viewport — render top-down when in fly or devWalk mode
    const activeKey = this._modeManager?.activeKey
    if ((activeKey === 'fly' || activeKey === 'devWalk') && this._minimapCam) {
      // Main view
      this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
      this.renderer.render(this.scene, activeCam)

      // Minimap
      const MARGIN = 10, HEIGHT = 180
      const aspect  = (this._minimapCam.right - this._minimapCam.left)
                    / (this._minimapCam.top   - this._minimapCam.bottom)
      const WIDTH   = Math.round(HEIGHT * aspect)
      const vpX     = MARGIN
      const vpY     = window.innerHeight - HEIGHT - MARGIN
      this.renderer.autoClear = false
      this.renderer.setScissorTest(true)
      this.renderer.setScissor(vpX, vpY, WIDTH, HEIGHT)
      this.renderer.setViewport(vpX, vpY, WIDTH, HEIGHT)
      this.renderer.clear()
      this.renderer.render(this.scene, this._minimapCam)
      this.renderer.setScissorTest(false)
      this.renderer.autoClear = true
      this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
      return
    }

    // Zone-edit mode renders through its own ortho camera (already in activeCam)
    if (this._modeManager?.activeKey === 'zoneEdit') {
      this.renderer.render(this.scene, activeCam)
      return
    }

    // Player view — route through EffectComposer so bloom applies.
    // Sync the render pass camera in case ModeManager switched it this frame.
    if (this._postProcessing) {
      this._postProcessing._renderPass.camera = activeCam
      this._postProcessing.render()
    } else {
      this.renderer.render(this.scene, activeCam)
    }
  }
}
