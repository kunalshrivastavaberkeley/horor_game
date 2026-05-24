// src/systems/LightingSystem.js
// Owns the Lantern — the only light source in the scene.
// Call applyLanternToScene() after all scene materials are created.

import * as THREE from 'three'
import { Lantern } from './Lantern.js'

const AMBIENT_CATACOMB = 0.0

export class LightingSystem {
  constructor(scene, gsm, renderer) {
    this._scene    = scene
    this._gsm      = gsm
    this._renderer = renderer
    this._camera   = null
    this._lantern  = null
    this._ready    = false
  }

  init() {
    this._ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_CATACOMB)
    this._scene.add(this._ambientLight)

    // Dev lighting — neutral overcast for editing, off in game
    this._devAmbient = new THREE.AmbientLight(0xffffff, 0)
    this._devSun     = new THREE.DirectionalLight(0xffffff, 0)
    this._devSun.position.set(1, 3, 2)
    this._scene.add(this._devAmbient)
    this._scene.add(this._devSun)
    this._devLighting = false

    this._lantern = new Lantern(this._scene, this._camera, this._renderer)
    this._ready = true
  }

  setCamera(cam) {
    this._camera = cam
    if (this._lantern) this._lantern._camera = cam
  }

  releaseCamera() { this._camera = null }

  setLanternMesh(mesh) {
    this._lantern.attachToMesh(mesh)
  }

  /**
   * Call once after ALL scene materials have been created (after setCatacombStoneAppearance).
   * Injects the negative light shader into every material in the scene.
   */
  applyLanternToScene() {
    this._lantern?.applyToScene()
  }

  // ── Forwarded controls ──────────────────────────────────────────────────────

  setOrbPosition(x, y, z)      { this._lantern?.setOrbPosition(x, y, z) }
  setLightHelperVisible(v)     { this._lantern?.setHelperVisible(v) }

  setPosLightRadius(r)    { if (this._lantern) this._lantern._uniforms.posLightRadius.value    = r }
  setPosLightIntensity(i) { if (this._lantern) this._lantern._uniforms.posLightIntensity.value = i }
  setPosNdotL(v)          { if (this._lantern) this._lantern._uniforms.posNdotL.value          = v }
  setCrawlRadius(r)    { if (this._lantern) this._lantern._uniforms.crawlRadius.value    = r }
  setCrawlIntensity(i) { if (this._lantern) this._lantern._uniforms.crawlIntensity.value = i }
  setCrawlNdotL(v)     { if (this._lantern) this._lantern._uniforms.crawlNdotL.value     = v }

  // ── Dev lighting ────────────────────────────────────────────────────────────

  setDevLighting(enabled) {
    this._devLighting = enabled
    if (enabled) {
      this._savedAmbientIntensity  = this._ambientLight.intensity
      this._ambientLight.intensity = 0
      this._devAmbient.intensity   = 0.55
      this._devSun.intensity       = 1.2
    } else {
      this._ambientLight.intensity = this._savedAmbientIntensity ?? AMBIENT_CATACOMB
      this._devAmbient.intensity   = 0
      this._devSun.intensity       = 0
    }
  }

  update(_delta) {
    this._lantern?.update()
  }
}
