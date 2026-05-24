// src/systems/settingsWiring.js
// Connects every setting key to its handler.
// Every key in settings.meta.json must appear in exactly one of:
//   handlers    — needs an explicit function call when the value changes
//   POLLED_KEYS — read directly from GameSettings each frame, no call needed

import meta from '../../data/settings.meta.json'

// Keys whose systems read GameSettings directly on each frame or at a specific
// moment — changing them takes effect automatically without a handler.
const POLLED_KEYS = new Set([
  'collision',    // coordinator reads each frame
  'minimap',      // GSM render loop reads each frame
  'coordsHUD',    // CameraController.update reads each frame
  'killPlane',    // CameraController.update reads each frame
  'headBob',      // CameraController._updateFP reads each frame
  'pitchDrift',   // CameraController._updateFP reads each frame
  'pitchLimit',   // CameraController._onMouseMove reads each frame
  'graphEditor',  // DevEditor.update reads each frame
  'tagEditor',    // DevEditor.update reads each frame
])

export function wireSettings(panel, systems) {
  const {
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
  } = systems

  const handlers = {
    cameraType:   v => cameraController.setType(v),
    projection:   v => cameraController.setProjection(v),
    physicsMesh:  v => playerController.setBodyVisible(v),
    lanternMesh:  v => playerController.setLanternVisible(v),
    devLighting:       v => lightingSystem.setDevLighting(v),
    lightHelper:       v => lightingSystem.setLightHelperVisible(v),
    orbX: _ => lightingSystem.setOrbPosition(GameSettings.orbX, GameSettings.orbY, GameSettings.orbZ),
    orbY: _ => lightingSystem.setOrbPosition(GameSettings.orbX, GameSettings.orbY, GameSettings.orbZ),
    orbZ: _ => lightingSystem.setOrbPosition(GameSettings.orbX, GameSettings.orbY, GameSettings.orbZ),
    posLightRadius:      v => lightingSystem.setPosLightRadius(v),
    posLightIntensity:   v => lightingSystem.setPosLightIntensity(v),
    posNdotL:            v => lightingSystem.setPosNdotL(v),
    crawlRadius:    v => lightingSystem.setCrawlRadius(v),
    crawlIntensity: v => lightingSystem.setCrawlIntensity(v),
    crawlNdotL:     v => lightingSystem.setCrawlNdotL(v),
    spatialGraph: v => {
      spatialSystem.setVisible(v)
      if (v) tagSystem.showCrosshair(gsm.camera)
      else   tagSystem.hideCrosshair()
    },
    tags: v => {
      tagSystem.setVisible(v)
      if (v) tagSystem.showCrosshair(gsm.camera)
      else   tagSystem.hideCrosshair()
    },
    motionBlur:    v => postProcessing.setMotionBlur(v),
    pathOverlay:   v => pathRecorder.setOverlayVisible(v),
    pathRecorder:  v => { pathRecorder.setActive(v); v ? panel.showPathManager() : panel.hidePathManager() },
    lanternPathVis: v => playerController.setLanternPathVis(v),
    catacombs:          v => sceneManagement.setVisualMeshVisible(v),
    lanternSheen:          v => playerController.setLanternSheen(v),
    lanternSheenRoughness: v => playerController.setLanternSheenRoughness(v),
  }

  // Validate: every key in meta is either handled or polled — no gaps, no extras
  const allMetaKeys = Object.values(meta).flatMap(f => Object.keys(f.settings))
  for (const key of allMetaKeys) {
    if (!handlers[key] && !POLLED_KEYS.has(key))
      throw new Error(`[settingsWiring] No handler or polled declaration for setting: "${key}"`)
  }
  for (const key of Object.keys(handlers)) {
    if (!allMetaKeys.includes(key))
      throw new Error(`[settingsWiring] Handler registered for unknown setting: "${key}"`)
  }

  for (const [key, fn] of Object.entries(handlers)) panel.on(key, fn)
}
