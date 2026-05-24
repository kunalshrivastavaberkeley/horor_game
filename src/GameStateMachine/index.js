import * as THREE from 'three'
import { StartState }    from './flow/StartState.js'
import { IntroState }    from './flow/IntroState.js'
import { PlayState }     from './flow/PlayState.js'
import { EndState }      from './flow/EndState.js'
import { SettingsState } from './utilities/SettingsState.js'

const STATES = {
  START:    StartState,
  INTRO:    IntroState,
  PLAY:     PlayState,
  END:      EndState,
  SETTINGS: SettingsState,
}

export class GameStateMachine {
  constructor(viewportEl) {
    this._viewportEl = viewportEl ?? document.getElementById('app')

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap

    // Canvas fills the viewport panel
    const canvas = this.renderer.domElement
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    Object.assign(this._viewportEl.style, { position: 'relative' })
    this._viewportEl.appendChild(canvas)

    const w = this._viewportEl.clientWidth  || window.innerWidth
    const h = this._viewportEl.clientHeight || window.innerHeight
    this.renderer.setSize(w, h)

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000)
    this.scene.add(this.camera)

    this.currentStateName = null
    this.currentState     = null
    this.isActive         = false

    this.systems = {}

    this._clock            = new THREE.Clock()
    this._cameraController = null
    this._minimapCam       = null

    // Track viewport size for the render loop
    this._vw = w
    this._vh = h

    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (!width || !height) return
      this._vw = width
      this._vh = height
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height)
      this.systems.postProcessing?.setSize(width, height)
    }).observe(this._viewportEl)
  }

  registerSystem(name, system) { this.systems[name] = system }

  setCameraController(cc)  { this._cameraController = cc }
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

  onExitReached()    { if (this.currentStateName !== 'END') this.transition('END') }
  onPlayerCaught()   { if (this.currentStateName !== 'END') this.transition('END') }
  onPause()          { console.log('[GSM] Pause requested (pointer lock lost)') }

  _loop() {
    requestAnimationFrame(() => this._loop())
    const delta = this._clock.getDelta()

    this.currentState?.update?.(this, delta)
    for (const sys of Object.values(this.systems)) sys.update?.(delta)

    const activeCam  = this._cameraController?.activeCamera ?? this.camera
    const settings   = this.systems.settings

    const vw = this._vw, vh = this._vh

    // Main render
    this.renderer.setViewport(0, 0, vw, vh)
    if (this.systems.postProcessing?.isActive) {
      this.systems.postProcessing.render()
    } else {
      this.renderer.render(this.scene, activeCam)
    }

    // Minimap sub-viewport
    if (settings?.minimap && this._minimapCam) {
      const MARGIN = 10, HEIGHT = 180
      const aspect = (this._minimapCam.right - this._minimapCam.left)
                   / (this._minimapCam.top   - this._minimapCam.bottom)
      const WIDTH  = Math.round(HEIGHT * aspect)
      const vpX    = MARGIN
      const vpY    = vh - HEIGHT - MARGIN
      this.renderer.autoClear = false
      this.renderer.setScissorTest(true)
      this.renderer.setScissor(vpX, vpY, WIDTH, HEIGHT)
      this.renderer.setViewport(vpX, vpY, WIDTH, HEIGHT)
      this.renderer.clear()
      this.renderer.render(this.scene, this._minimapCam)
      this.renderer.setScissorTest(false)
      this.renderer.autoClear = true
      this.renderer.setViewport(0, 0, vw, vh)
    }
  }
}
