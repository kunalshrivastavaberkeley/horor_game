// src/systems/LightingSystem.js
// Manages all lights in the scene. Leaf node — no outputs to other systems.
// Niko light is dynamic (sanity-driven). All other lights are static after init.

import * as THREE from 'three'

// Tunable constants — all light parameters live here, never inline
const NIKO_INTENSITY_MAX      = 2.5
const NIKO_INTENSITY_MIN      = 0.5
const NIKO_RADIUS_MAX         = 8.0
const NIKO_RADIUS_MIN         = 2.0
const NIKO_EMISSIVE_MAX       = 0.5
const NIKO_LERP_RATE          = 3.0
const AMBIENT_CATACOMB        = 0.05
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
    this._nikoMesh = null
    this._bulbMesh = null
    this._bulbMaterials = []
    this._ambientLight = null
    this._pointLights = []
    this._ready = false
  }

  /** Called once the Niko mesh is loaded so the point light can track it. */
  setNikoMesh(mesh) {
    this._nikoMesh = mesh
  }

  /** Called once the lightbulb mesh is loaded. Makes its materials emissive. */
  setBulbMesh(mesh) {
    this._bulbMesh = mesh
    this._bulbMaterials = []
    mesh.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (let i = 0; i < mats.length; i++) {
        const old = mats[i]
        if (old.isMeshBasicMaterial) {
          const upgraded = new THREE.MeshStandardMaterial({
            map:         old.map,
            color:       old.color,
            transparent: old.transparent,
            opacity:     old.opacity,
            alphaTest:   old.alphaTest,
            side:        old.side,
            name:        old.name,
            roughness:   0.0,
            metalness:   0.0,
          })
          if (Array.isArray(obj.material)) obj.material[i] = upgraded
          else obj.material = upgraded
          old.dispose()
          mats[i] = upgraded
        }
        const mat = mats[i]
        mat.emissive.set(0xffdd88)
        mat.emissiveIntensity = NIKO_EMISSIVE_MAX
        this._bulbMaterials.push(mat)
      }
    })
  }

  /**
   * Initialize lights from zone data.
   * @param {Array} zones - array of zone objects from ZoneSystem.zones
   */
  init(zones) {
    this._ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_CATACOMB)
    this._scene.add(this._ambientLight)

    // Niko's point light — added to scene; position tracked from nikoMesh each frame
    this._nikoLight = new THREE.PointLight(0xffeedd, NIKO_INTENSITY_MAX, NIKO_RADIUS_MAX)
    this._scene.add(this._nikoLight)

    this._nikoLightHelper = new THREE.PointLightHelper(this._nikoLight, 0.15)
    this._scene.add(this._nikoLightHelper)

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

    // Dev lighting — neutral overcast look: soft ambient + directional for depth
    this._devAmbient = new THREE.AmbientLight(0xffffff, 0)
    this._devSun = new THREE.DirectionalLight(0xffffff, 0)
    this._devSun.position.set(1, 3, 2)
    this._scene.add(this._devAmbient)
    this._scene.add(this._devSun)
    this._devLighting = false

    console.log(`[LightingSystem] Initialized — ${this._pointLights.length} static point lights`)
    this._ready = true
  }

  /**
   * Toggle between game lighting and flat full-bright dev lighting.
   * @param {boolean} enabled
   */
  setDevLighting(enabled) {
    this._devLighting = enabled
    if (enabled) {
      this._savedAmbientIntensity = this._ambientLight.intensity
      this._ambientLight.intensity = 0
      for (const l of this._pointLights) l.visible = false
      if (this._nikoLight) this._nikoLight.visible = false
      this._devAmbient.intensity = 0.55
      this._devSun.intensity = 1.2
    } else {
      this._ambientLight.intensity = this._savedAmbientIntensity ?? 0.6
      for (const l of this._pointLights) l.visible = true
      if (this._nikoLight) this._nikoLight.visible = true
      this._devAmbient.intensity = 0
      this._devSun.intensity = 0
    }
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

  setCamera(cam) { this._camera = cam }

  releaseCamera() { this._camera = null }

  /**
   * Per-frame update. Only updates Niko light during ACTIVE state.
   * @param {number} delta - seconds
   */
  update(delta) {
    if (!this._gsm.isActive || !this._nikoLight) return

    const lightSource = this._bulbMesh ?? this._nikoMesh
    if (lightSource) {
      lightSource.getWorldPosition(this._nikoLight.position)
      this._nikoLightHelper.update()
    }

    const sanityFloat = this._gsm.systems.sanity?.getSanity() ?? 1
    const hugging     = this._gsm.systems.player?.nikoState === 'hugging'

    const targetIntensity = (NIKO_INTENSITY_MIN + sanityFloat * (NIKO_INTENSITY_MAX - NIKO_INTENSITY_MIN)) * (hugging ? 0.05 : 1.0)
    const targetRadius    = (NIKO_RADIUS_MIN    + sanityFloat * (NIKO_RADIUS_MAX    - NIKO_RADIUS_MIN))    * (hugging ? 0.2  : 1.0)

    this._nikoLight.intensity += (targetIntensity - this._nikoLight.intensity) * NIKO_LERP_RATE * delta
    this._nikoLight.distance  += (targetRadius    - this._nikoLight.distance)  * NIKO_LERP_RATE * delta

    this._nikoLight.intensity = Math.max(this._nikoLight.intensity, NIKO_INTENSITY_MIN)
    this._nikoLight.distance  = Math.max(this._nikoLight.distance,  NIKO_RADIUS_MIN)

  }
}
