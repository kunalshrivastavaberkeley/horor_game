// src/systems/AudioManager.js
// Sub-orchestrator for all game audio. Three layers: scene, transition, action.
// Requires a click-to-start gate (browser autoplay policy).

// Single config block — all tunable values named by intent
const AUDIO_CONFIG = {
  crossfadeDuration: {
    menuToIntro:    1.5,
    introToDesert:  2.0,
    desertToTemple: 3.0,
    templeToEnd:    2.0,
    settingsResume: 0.8,
  },
  sceneVolume: {
    menu:   0.6,
    intro:  0.5,
    desert: 0.55,
    temple: 0.5,
    end:    0.4,
  },
  actionVolume: {
    lanternPickup:  0.5,
    lanternPutdown: 0.5,
    lanternHug:     0.6,
    uiButton:       0.3,
  }
}

// Maps GSM state names to audio files
const SCENE_AUDIO = {
  MENU:  'menu-ambient.mp3',
  INTRO: 'intro-audio.mp3',
  PLAY:  'play-ambient.mp3',
  END:   'end-audio.mp3',
}

const ALL_AUDIO_FILES = [
  'menu-ambient.mp3', 'intro-audio.mp3', 'play-ambient.mp3',
  'end-audio.mp3',
'niko-pickup.mp3', 'niko-putdown.mp3', 'niko-hug.mp3', 'ui-button.mp3'
]

export class AudioManager {
  constructor() {
    this._ctx = null
    this._unlocked = false
    this._buffers = {}
    this._filePaths = {}

    this._masterGain = null
    this._sceneGain = null
    this._transitionGain = null
    this._actionGain = null
    this._sceneSource = null      // currently playing scene BufferSource
    this._transitionSource = null
    this._crossfadeTimeout = null

    this._currentState = null
    this._prevState = null
    // Gate: unlock AudioContext on first user interaction
    document.addEventListener('click', () => this._unlock(), { once: true })
  }

  /**
   * Call during scene loading to register audio file paths.
   * Actual decoding happens after AudioContext is unlocked.
   */
  preload() {
    for (const file of ALL_AUDIO_FILES) {
      this._filePaths[file] = `/audio/${file}`
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  /**
   * Called by GameStateMachine (or flow states) when GSM state changes.
   * @param {'MENU'|'INTRO'|'PLAY'|'END'|'SETTINGS'} stateName
   */
  onStateChange(stateName) {
    this._prevState = this._currentState
    this._currentState = stateName

    if (!this._unlocked) return  // will be applied when unlock fires

    if (stateName === 'SETTINGS') {
      this._hardStop()
      return
    }

    if (this._prevState === 'SETTINGS') {
      // Resume audio — if a scene source exists, just fade gain back in
      // If no source (game entered SETTINGS before any audio started), crossfade normally
      if (this._sceneSource) {
        const vol = AUDIO_CONFIG.sceneVolume[stateName.toLowerCase()] ?? 0.5
        this._sceneGain.gain.linearRampToValueAtTime(vol, this._ctx.currentTime + AUDIO_CONFIG.crossfadeDuration.settingsResume)
      } else {
        this._crossfadeTo(stateName)
      }
      return
    }

    this._crossfadeTo(stateName)
  }

  // ─── Crossfade ───────────────────────────────────────────────────────────────

  _crossfadeTo(stateName) {
    const filename = SCENE_AUDIO[stateName]
    if (!filename) return  // no scene audio for this state

    const buf = this._buffers[filename]
    if (!buf) {
      console.warn(`[AudioManager] Buffer not ready for ${filename} — was preload() called?`)
      return
    }

    const targetVol = AUDIO_CONFIG.sceneVolume[stateName.toLowerCase()] ?? 0.5
    const duration  = this._getCrossfadeDuration(this._prevState, stateName)
    const now       = this._ctx.currentTime

    // Fade out old scene layer
    if (this._sceneGain) {
      this._sceneGain.gain.cancelScheduledValues(now)
      this._sceneGain.gain.setValueAtTime(this._sceneGain.gain.value, now)
      this._sceneGain.gain.linearRampToValueAtTime(0, now + duration)
    }

    // New source on transition layer — fades in
    const src = this._ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(this._transitionGain)
    src.start()
    this._transitionSource = src

    this._transitionGain.gain.cancelScheduledValues(now)
    this._transitionGain.gain.setValueAtTime(0, now)
    this._transitionGain.gain.linearRampToValueAtTime(targetVol, now + duration)

    // After fade: swap to scene channel, stop old source
    if (this._crossfadeTimeout) clearTimeout(this._crossfadeTimeout)
    this._crossfadeTimeout = setTimeout(() => {
      // Stop old scene source
      if (this._sceneSource) {
        try { this._sceneSource.stop() } catch (_) {}
        this._sceneSource.disconnect()
      }
      // Reroute new source to scene gain
      src.disconnect(this._transitionGain)
      src.connect(this._sceneGain)
      this._sceneGain.gain.cancelScheduledValues(this._ctx.currentTime)
      this._sceneGain.gain.setValueAtTime(targetVol, this._ctx.currentTime)
      this._transitionGain.gain.setValueAtTime(0, this._ctx.currentTime)
      this._sceneSource = src
      this._transitionSource = null
    }, duration * 1000)
  }

  _hardStop() {
    if (!this._ctx) return
    const now = this._ctx.currentTime
    this._sceneGain?.gain.setValueAtTime(0, now)
    this._transitionGain?.gain.setValueAtTime(0, now)
  }

  _getCrossfadeDuration(from, to) {
    if (!from) return 0
    const key = `${from.toLowerCase()}To${to.charAt(0).toUpperCase()}${to.slice(1).toLowerCase()}`
    return AUDIO_CONFIG.crossfadeDuration[key] ?? 1.5
  }

  // ─── Action sounds ───────────────────────────────────────────────────────────

  playLanternPickup()  { this._playAction('niko-pickup.mp3',  AUDIO_CONFIG.actionVolume.lanternPickup) }
  playLanternPutdown() { this._playAction('niko-putdown.mp3', AUDIO_CONFIG.actionVolume.lanternPutdown) }
  playLanternHug()     { this._playAction('niko-hug.mp3',     AUDIO_CONFIG.actionVolume.lanternHug) }
  playUIButton()       { this._playAction('ui-button.mp3',    AUDIO_CONFIG.actionVolume.uiButton) }

  _playAction(filename, vol) {
    if (!this._ctx || !this._buffers[filename]) return
    const src = this._ctx.createBufferSource()
    src.buffer = this._buffers[filename]
    const gainNode = this._ctx.createGain()
    gainNode.gain.value = vol
    src.connect(gainNode)
    gainNode.connect(this._actionGain)
    src.start()
    // Disconnect after playback to prevent memory leak (Web Audio nodes stay in graph until disconnected)
    src.onended = () => {
      src.disconnect()
      gainNode.disconnect()
    }
  }

  // ─── Unlock / preload ─────────────────────────────────────────────────────────

  async _unlock() {
    if (this._unlocked) return
    this._ctx = new (window.AudioContext || window.webkitAudioContext)()
    this._unlocked = true

    // Build audio graph
    this._masterGain = this._ctx.createGain()
    this._masterGain.gain.value = 1
    this._masterGain.connect(this._ctx.destination)

    this._sceneGain = this._ctx.createGain()
    this._sceneGain.gain.value = 0
    this._sceneGain.connect(this._masterGain)

    this._transitionGain = this._ctx.createGain()
    this._transitionGain.gain.value = 0
    this._transitionGain.connect(this._masterGain)

    this._actionGain = this._ctx.createGain()
    this._actionGain.gain.value = 1
    this._actionGain.connect(this._masterGain)  // action bypasses filter (one-shot events)

    await this._loadAllBuffers()

    // Apply current state if GSM already transitioned before unlock
    if (this._currentState && this._currentState !== 'SETTINGS') {
      this._crossfadeTo(this._currentState)
    }
  }

  async _loadAllBuffers() {
    const promises = Object.entries(this._filePaths).map(([name, path]) =>
      fetch(path)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.arrayBuffer()
        })
        .then(ab => this._ctx.decodeAudioData(ab))
        .then(buf => { this._buffers[name] = buf })
        .catch(e => console.warn(`[AudioManager] Failed to load ${name}: ${e.message}`))
    )
    await Promise.all(promises)
    console.log(`[AudioManager] ${Object.keys(this._buffers).length} / ${ALL_AUDIO_FILES.length} audio buffers loaded`)
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────────

  /**
   * Called by GSM render loop each frame.
   * @param {number} _delta - unused but present for system interface consistency
   */
  update(_delta) {
    // Intentionally minimal — audio is event-driven, not per-frame polled
  }
}
