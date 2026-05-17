// src/systems/LightingSystem.js
// Manages all lights in the scene. Leaf node — no outputs to other systems.
// Niko light is dynamic (sanity-driven). All other lights are static after init.

import * as THREE from 'three'

// Tunable constants — all light parameters live here, never inline
const NIKO_INTENSITY_MAX      = 2.0
const NIKO_INTENSITY_MIN      = 0.3
const NIKO_RADIUS_MAX         = 8.0
const NIKO_RADIUS_MIN         = 2.0
const NIKO_Y_OFFSET           = 0.3   // offset from camera origin
const NIKO_LERP_RATE          = 3.0   // units/second toward target
const AMBIENT_DESERT          = 0.6
const AMBIENT_TEMPLE          = 0.05
const TORCH_INTENSITY         = 3.0
const TORCH_COLOR             = 0xff8800
const TORCH_RADIUS            = 4.0
const TORCH_Y                 = 2.0
const ARTIFACT_INTENSITY      = 0.8
const ARTIFACT_COLOR          = 0x88aaff
const ARTIFACT_RADIUS         = 3.0
const ARTIFACT_Y              = 1.0
const ZONE_LIGHT_INTENSITY    = 1.2
const ZONE_LIGHT_COLOR        = 0xffffff
const ZONE_LIGHT_RADIUS_SCALE = 0.8   // multiplier applied to zone dimensions
const ZONE_LIGHT_Y            = 2.5
const MAX_POINT_LIGHTS        = 64    // soft cap — logs warning if exceeded at init

export class LightingSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(scene, gsm) {
    this._scene = scene
    this._gsm = gsm
    this._camera = null
    this._nikoLight = null
    this._ambientLight = null
    this._pointLights = []
    this._ready = false
  }

  /**
   * Initialize lights from zone data.
   * @param {Array} zones - array of zone objects from ZoneSystem.zones
   */
  init(zones) {
    // Ambient light — starts in desert value
    this._ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_DESERT)
    this._scene.add(this._ambientLight)

    // Niko's point light — attached to camera on setCamera()
    this._nikoLight = new THREE.PointLight(0xffeedd, NIKO_INTENSITY_MAX, NIKO_RADIUS_MAX)
    this._nikoLight.position.set(0, NIKO_Y_OFFSET, 0)
    // NOTE: not added to scene directly — added as child of camera via setCamera()

    // Static lights from zone data
    let lightCount = 0
    for (const zone of (zones || [])) {
      if (lightCount >= MAX_POINT_LIGHTS) {
        console.warn(`[LightingSystem] MAX_POINT_LIGHTS (${MAX_POINT_LIGHTS}) reached — some zone lights skipped`)
        break
      }
      const light = this._createZoneLight(zone)
      if (light) {
        this._scene.add(light)
        this._pointLights.push(light)
        lightCount++
      }
    }

    console.log(`[LightingSystem] Initialized — ${this._pointLights.length} static point lights`)
    this._ready = true
  }

  _createZoneLight(zone) {
    switch (zone.layer) {
      case 'torch_zones': {
        const l = new THREE.PointLight(TORCH_COLOR, TORCH_INTENSITY, TORCH_RADIUS)
        l.position.set(zone.x, TORCH_Y, zone.z)
        return l
      }
      case 'artifact_zones': {
        const l = new THREE.PointLight(ARTIFACT_COLOR, ARTIFACT_INTENSITY, ARTIFACT_RADIUS)
        l.position.set(zone.x, ARTIFACT_Y, zone.z)
        return l
      }
      case 'light_zones': {
        const radius = Math.max(zone.width, zone.depth) * ZONE_LIGHT_RADIUS_SCALE
        const l = new THREE.PointLight(ZONE_LIGHT_COLOR, ZONE_LIGHT_INTENSITY, radius)
        l.position.set(zone.x, ZONE_LIGHT_Y, zone.z)
        return l
      }
      default:
        return null  // dark_zones, artifact_spawns — no light created
    }
  }

  /**
   * Called by GSM when ACTIVE state begins (DESERT/TEMPLE enter).
   * Attaches Niko light as child of camera.
   * @param {THREE.Camera} cam
   */
  setCamera(cam) {
    this._camera = cam
    if (this._nikoLight) {
      this._camera.add(this._nikoLight)
    }
  }

  /**
   * Called by GSM when ACTIVE state exits.
   * Detaches Niko light from camera.
   */
  releaseCamera() {
    if (this._nikoLight && this._camera) {
      this._camera.remove(this._nikoLight)
    }
    this._camera = null
  }

  /**
   * Called by ZoneSystem when player crosses desert/temple boundary.
   * @param {'desert'|'temple'} zone
   */
  onSceneZoneChange(zone) {
    if (!this._ambientLight) return
    this._ambientLight.intensity = zone === 'temple' ? AMBIENT_TEMPLE : AMBIENT_DESERT
    console.log(`[LightingSystem] Ambient → ${zone} (${this._ambientLight.intensity})`)
  }

  /**
   * Per-frame update. Only updates Niko light during ACTIVE state.
   * @param {number} delta - seconds
   */
  update(delta) {
    if (!this._gsm.isActive || !this._nikoLight) return

    const sanityFloat = this._gsm.systems.sanity?.getSanity() ?? 1

    const targetIntensity = NIKO_INTENSITY_MIN + sanityFloat * (NIKO_INTENSITY_MAX - NIKO_INTENSITY_MIN)
    const targetRadius    = NIKO_RADIUS_MIN    + sanityFloat * (NIKO_RADIUS_MAX    - NIKO_RADIUS_MIN)

    // Lerp toward target — clamp to prevent going below floor
    this._nikoLight.intensity += (targetIntensity - this._nikoLight.intensity) * NIKO_LERP_RATE * delta
    this._nikoLight.distance  += (targetRadius    - this._nikoLight.distance)  * NIKO_LERP_RATE * delta

    // Hard floor — light never fully off
    this._nikoLight.intensity = Math.max(this._nikoLight.intensity, NIKO_INTENSITY_MIN)
    this._nikoLight.distance  = Math.max(this._nikoLight.distance,  NIKO_RADIUS_MIN)
  }
}
