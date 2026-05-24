import * as THREE from 'three'
import { CutscenePlayer } from './CutscenePlayer.js'

// ─── Timing ──────────────────────────────────────────────────────────────────
const FADE_DURATION        = 2.0    // seconds: black → visible
const RISE_DURATION        = 3.5    // seconds: camera rises from floor to eye level
const SLUG_DURATION        = 20.0   // seconds of sluggish movement after fade-in
const SLUG_START           = 0.3   // movement multiplier at beginning of slug phase (groggy)
const PICKUP_FADE_DURATION = 0.6    // seconds: intro ambient fades out after pickup

// ─── Camera ──────────────────────────────────────────────────────────────────
const FLOOR_OFFSET   = -1.4          // camera Y below playerPosition when prone
const PITCH_START    = -Math.PI / 2  // looking straight at the floor
const PITCH_END      = -0.10         // PITCH_NEUTRAL from PlayerWalkMode
const PITCH_RISE_SPEED = 0.9         // rad/s toward PITCH_END (slower than normal drift)

// ─── World lantern — position on the floor ────────────────────────────────────
const LANTERN_FLOOR_OFFSET = new THREE.Vector3(-8, -2.1, -6)
const LANTERN_PICKUP_DIST  = 4.5
const LANTERN_PROMPT_DIST  = 4.5   // distance at which the pickup hint appears

// ─── Intro ambient — just enough to make out walls in total darkness ──────────
const INTRO_AMBIENT_COLOR     = 0x1a1008   // near-black warm tint (torchlight residue)
const INTRO_AMBIENT_INTENSITY = 0.18       // very dim — walls visible, mood intact

export class IntroSequence {
  // pathData: parsed JSON from data/paths/intro.json, or null to fall back to manual rise.
  constructor(gsm, playerController, cameraController, pathData = null) {
    this._gsm  = gsm
    this._pc   = playerController
    this._wm   = cameraController   // same API: slugMultiplier, swayAmount, inputDriftSpeed, lookAngles, setLookAngles

    this._active          = false
    this._cameraReleased  = false
    this._cameraHanded    = false
    this._finished        = false
    this._t               = 0
    this._introPitch      = PITCH_START
    this._onDone          = null
    this._pickupFadeT     = -1

    // Scripted path (optional). When present it replaces the manual rise animation.
    this._cutscene        = null
    this._cutsceneStarted = false
    this._cutsceneDone    = false
    this._pathEndT        = null   // _t value when the path finished

    if (pathData?.waypoints?.length >= 2) {
      this._cutscene = new CutscenePlayer()
      this._cutscene.setPath(pathData.waypoints)
    }

    this._overlay       = null
    this._lanternLight  = null
    this._introAmbient  = null
    this._pickupPrompt  = null

    this._onKeyUp = (e) => {
      if (e.code === 'KeyE') this._tryPickup()
    }
  }

  // ─── Public ────────────────────────────────────────────────────────────────

  start(onDone) {
    this._onDone          = onDone
    this._active          = true
    this._cameraReleased  = false
    this._cameraHanded    = false
    this._finished        = false
    this._t               = 0
    this._introPitch      = PITCH_START
    this._pickupFadeT     = -1
    this._cutsceneStarted = false
    this._cutsceneDone    = false
    this._pathEndT        = null

    // Black overlay
    this._overlay = document.createElement('div')
    Object.assign(this._overlay.style, {
      position: 'fixed', inset: '0',
      background: '#000', opacity: '1',
      zIndex: '50', pointerEvents: 'none',
    })
    document.body.appendChild(this._overlay)

    // Freeze camera, zero movement; full sway + max drift lag
    this._pc.freezeCamera(true)
    this._wm.slugMultiplier  = 0
    this._wm.swayAmount      = 1.0
    this._wm.inputDriftSpeed = 0.5

    // Mark game active so PlayerWalkMode processes WASD (movement only, not camera)
    this._gsm.setGameActive(true)

    // Place lantern on the floor — tune LANTERN_FLOOR_OFFSET to position correctly
    const lanternMesh = this._pc._lanternMesh
    if (lanternMesh) {
      lanternMesh.position.copy(this._pc.playerPosition).add(LANTERN_FLOOR_OFFSET)
      lanternMesh.visible = true
    }

    const lanternPos = this._pc.playerPosition.clone().add(LANTERN_FLOOR_OFFSET)
    this._lanternLight = new THREE.PointLight(0xffe0a0, 2.4, 14)
    this._lanternLight.position.copy(lanternPos)
    this._gsm.scene.add(this._lanternLight)

    // Faint ambient so the player can make out walls — fades in with the overlay
    this._introAmbient = new THREE.AmbientLight(INTRO_AMBIENT_COLOR, 0)
    this._gsm.scene.add(this._introAmbient)

    this._gsm.systems.postProcessing?.enableMotionBlur()

    // Pickup hint — hidden until player is close enough
    this._pickupPrompt = document.createElement('div')
    Object.assign(this._pickupPrompt.style, {
      position:   'fixed',
      bottom:     '80px',
      left:       '50%',
      transform:  'translateX(-50%)',
      color:      '#e8d8b0',
      fontFamily: 'serif',
      fontSize:   '18px',
      letterSpacing: '0.08em',
      textShadow: '0 0 8px rgba(0,0,0,0.9)',
      opacity:    '0',
      transition: 'opacity 0.4s ease',
      pointerEvents: 'none',
      zIndex:     '60',
      userSelect: 'none',
    })
    this._pickupPrompt.textContent = 'Press E to pick up the lantern'
    document.body.appendChild(this._pickupPrompt)

    window.addEventListener('keyup', this._onKeyUp)
  }

  // Called from IntroState.update each frame
  tick(delta) {
    if (!this._active || this._finished) return

    // Pickup fade: dim intro lighting to zero, then complete
    if (this._pickupFadeT >= 0) {
      this._pickupFadeT += delta
      const alpha = Math.max(0, 1 - this._pickupFadeT / PICKUP_FADE_DURATION)
      if (this._introAmbient) this._introAmbient.intensity = INTRO_AMBIENT_INTENSITY * alpha
      if (this._lanternLight) this._lanternLight.intensity  = 2.4 * alpha
      if (alpha <= 0) this._complete()
      return
    }

    this._t += delta

    this._updateOverlay()
    this._updateCutscene(delta)
    this._updateCamera(delta)
    this._updateSlug()
    this._updatePickupPrompt()
  }

  // ─── Private — per-frame ──────────────────────────────────────────────────

  _updateOverlay() {
    if (!this._overlay) return
    if (this._t < FADE_DURATION) {
      const alpha = this._t / FADE_DURATION
      this._overlay.style.opacity = String(1 - alpha)
      if (this._introAmbient) this._introAmbient.intensity = INTRO_AMBIENT_INTENSITY * alpha
    } else {
      this._overlay.style.opacity = '0'
      if (this._introAmbient) this._introAmbient.intensity = INTRO_AMBIENT_INTENSITY
    }
  }

  _updateCutscene(delta) {
    if (!this._cutscene || this._cutsceneDone) return
    if (this._t < FADE_DURATION) return   // wait for fade-in before starting

    if (!this._cutsceneStarted) {
      this._cutsceneStarted = true
      this._cutscene.play(this._gsm.camera, () => {
        this._cutsceneDone = true
        this._pathEndT     = this._t
        this._cameraReleased = true
        this._pc.freezeCamera(false)
        // Hand look angles to walk mode so slug drift starts from the path's final orientation
        const cam = this._gsm.camera
        this._wm.setLookAngles(cam.rotation.y, cam.rotation.x)
      })
    } else {
      this._cutscene.tick(delta)
    }
  }

  _updateCamera(delta) {
    // When a scripted path is active, CutscenePlayer drives the camera — skip manual rise.
    if (this._cutscene && !this._cutsceneDone) return

    // Keep animating pitch even after release so setLookAngles gets the final value
    const pitchDiff = PITCH_END - this._introPitch
    this._introPitch += pitchDiff * Math.min(1, PITCH_RISE_SPEED * delta)

    if (this._cameraReleased) return  // PlayerWalkMode owns the camera now

    const riseT     = Math.max(0, this._t - FADE_DURATION)
    const riseAlpha = Math.min(1, riseT / RISE_DURATION)
    const heightOff = FLOOR_OFFSET * (1 - riseAlpha)

    const cam = this._gsm.camera
    const pos = this._pc.playerPosition

    cam.position.set(pos.x, pos.y + heightOff, pos.z)
    cam.rotation.order = 'YXZ'
    cam.rotation.y     = this._wm.lookAngles.yaw
    cam.rotation.x     = this._introPitch

    // Rise complete — unfreeze so the player can look around during the slug phase
    if (riseAlpha >= 1 && !this._cameraReleased) {
      this._cameraReleased = true
      this._pc.freezeCamera(false)
      this._wm.setLookAngles(this._wm.lookAngles.yaw, this._introPitch)
    }
  }

  _updateSlug() {
    // Slug phase starts after fade (no path) or after the scripted path ends.
    const slugStart = this._pathEndT ?? FADE_DURATION
    if (this._cutscene && !this._cutsceneDone) return  // path still running
    if (this._t < slugStart) return
    const slugT = Math.min(1, (this._t - slugStart) / SLUG_DURATION)
    this._wm.slugMultiplier  = SLUG_START + (1 - SLUG_START) * slugT
    this._wm.swayAmount      = 1 - slugT
    this._wm.inputDriftSpeed = 0.5 + 9.5 * slugT
  }

  _updatePickupPrompt() {
    if (!this._pickupPrompt) return
    const lanternMesh = this._pc._lanternMesh
    if (!lanternMesh || !lanternMesh.visible) {
      this._pickupPrompt.style.opacity = '0'
      return
    }
    const dist = this._gsm.camera.position.distanceTo(lanternMesh.position)
    this._pickupPrompt.style.opacity = dist <= LANTERN_PROMPT_DIST ? '1' : '0'
  }

  // ─── Private — transitions ────────────────────────────────────────────────

  _handOffCamera() {
    if (this._cameraHanded) return
    this._cameraHanded   = true
    this._cameraReleased = true
    this._pc.freezeCamera(false)
    this._wm.setLookAngles(this._wm.lookAngles.yaw, this._introPitch)
    this._wm.slugMultiplier  = 1.0
    this._wm.swayAmount      = 0
    this._wm.inputDriftSpeed = 10
    this._gsm.systems.postProcessing?.disableMotionBlur()
  }

  _tryPickup() {
    if (this._finished || this._pickupFadeT >= 0) return
    const lanternMesh = this._pc._lanternMesh
    if (!lanternMesh || !lanternMesh.visible) return
    const dist = this._gsm.camera.position.distanceTo(lanternMesh.position)
    if (dist <= LANTERN_PICKUP_DIST) {
      this._handOffCamera()
      this._wm.slugMultiplier  = 1.0
      this._wm.swayAmount      = 0
      this._wm.inputDriftSpeed = 10
      this._gsm.systems.postProcessing?.disableMotionBlur()
      lanternMesh.visible = false  // carried lantern shows via setCamera() in PlayState
      this._pickupFadeT = 0
    }
  }

  _complete() {
    if (this._finished) return
    this._finished = true
    this._cleanup()
    this._onDone?.()
  }

  _cleanup() {
    window.removeEventListener('keyup', this._onKeyUp)

    if (this._overlay?.parentNode)      this._overlay.remove()
    this._overlay = null
    if (this._pickupPrompt?.parentNode) this._pickupPrompt.remove()
    this._pickupPrompt = null

    if (this._lanternLight) { this._gsm.scene.remove(this._lanternLight); this._lanternLight = null }
    if (this._introAmbient) { this._gsm.scene.remove(this._introAmbient); this._introAmbient = null }

    this._active = false
  }
}
