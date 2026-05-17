import * as THREE from 'three'
import { StartState } from './flow/StartState.js'
import { IntroState } from './flow/IntroState.js'
import { DesertState } from './flow/DesertState.js'
import { TempleState } from './flow/TempleState.js'
import { ExitState } from './flow/ExitState.js'
import { EndState } from './flow/EndState.js'
import { SettingsState } from './utilities/SettingsState.js'

const STATES = {
  START: StartState,
  INTRO: IntroState,
  DESERT: DesertState,
  TEMPLE: TempleState,
  EXIT: ExitState,
  END: EndState,
  SETTINGS: SettingsState,
}

export class GameStateMachine {
  constructor() {
    // Renderer — init once at boot
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    document.getElementById('app').appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.scene.add(this.camera) // camera in scene so child lights work

    this.currentStateName = null
    this.currentState = null
    this.isActive = false // true during DESERT/TEMPLE/EXIT gameplay

    // Systems registry — set by main.js after construction
    this.systems = {}

    this._clock = new THREE.Clock()
    this._postProcessing = null // set by main.js for render override

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      if (this._postProcessing) this._postProcessing._composer?.setSize(window.innerWidth, window.innerHeight)
    })
  }

  registerSystem(name, system) {
    this.systems[name] = system
  }

  setPostProcessing(pp) {
    this._postProcessing = pp
  }

  start() {
    this.transition('START')
    this._loop()
  }

  transition(stateName) {
    if (!STATES[stateName]) { console.error(`[GSM] Unknown state: ${stateName}`); return }
    if (this.currentState?.exit) this.currentState.exit(this)
    this.currentStateName = stateName
    this.currentState = new STATES[stateName]()
    this.currentState.enter(this)
    console.log(`[GSM] → ${stateName}`)
  }

  setGameActive(val) {
    this.isActive = val
  }

  // Called by SanitySystem
  onSanityDepleted() {
    if (this.currentStateName !== 'END') this.transition('END')
  }

  // Called by TriggerSystem (exit zone)
  onExitReached() {
    if (this.currentStateName !== 'END') this.transition('END')
  }

  // Called by EnemySystem (player caught)
  onPlayerCaught() {
    if (this.currentStateName !== 'END') this.transition('END')
  }

  // Called by PlayerController (pointer lock lost)
  onPause() {
    // Conservative decision: log only — full pause screen out of scope per spec
    console.log('[GSM] Pause requested (pointer lock lost)')
  }

  _loop() {
    requestAnimationFrame(() => this._loop())
    const delta = this._clock.getDelta()

    // Tick current state
    this.currentState?.update?.(this, delta)

    // Tick all registered systems
    for (const sys of Object.values(this.systems)) {
      sys.update?.(delta)
    }

    // PostProcessing render or fallback
    if (this._postProcessing && this.isActive) {
      this._postProcessing.update(delta, this.systems.sanity?.getSanity?.() ?? 1)
      this._postProcessing.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }
}
