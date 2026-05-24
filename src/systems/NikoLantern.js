// src/systems/NikoLantern.js
// Two custom lights implemented entirely as shader uniforms — no THREE.PointLight.
//
//  Positive light  — centered on Niko's light offset, adds to outgoingLight.
//                    Niko's mesh body naturally occludes it (geometry blocks light).
//  Negative light  — centered on the player (camera origin in view space = vec3(0)).
//                    Multiplicatively darkens nearby surfaces, hiding close geometry.
//
// Both run simultaneously in the same shader injection.

import * as THREE from 'three'

const POS_COLOR     = new THREE.Color(0xffdd88)
const POS_INTENSITY = 2.0
const POS_RADIUS    = 30.0
const POS_RADIUS_HUG = 4.0
const ORB_OFFSET    = new THREE.Vector3(0, 1, 0)  // local offset on Niko mesh — shared by both lights

const NEG_RADIUS    = 2.0
const NEG_INTENSITY = 1.0

export class NikoLantern {
  constructor(scene, camera) {
    this._scene   = scene
    this._camera  = camera
    this._nikoMesh = null

    this._lightWorldPos = new THREE.Vector3()
    this._lightViewPos  = new THREE.Vector3()

    // Shared uniforms — one object written per frame, read by all injected materials
    this._uniforms = {
      posLightPosView:  { value: new THREE.Vector3() },
      posLightColor:    { value: POS_COLOR.clone() },
      posLightRadius:   { value: POS_RADIUS },
      posLightIntensity:{ value: POS_INTENSITY },
      negLightRadius:   { value: NEG_RADIUS },
      negLightIntensity:{ value: NEG_INTENSITY },
    }

    this._helper = null
  }

  // ── Setup ───────────────────────────────────────────────────────────────────

  attachToNiko(nikoMesh) {
    this._nikoMesh = nikoMesh

    // Visual helper only — no actual Three.js light
    this._helperMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffdd88, wireframe: true })
    )
    this._helperMesh.position.copy(ORB_OFFSET)
    nikoMesh.add(this._helperMesh)
  }

  setOrbPosition(x, y, z) {
    ORB_OFFSET.set(x, y, z)
    if (this._helperMesh) this._helperMesh.position.set(x, y, z)
  }

  setHelperVisible(v) {
    if (this._helperMesh) this._helperMesh.visible = v
  }

  onNikoStateChange(state) {
    this._uniforms.posLightRadius.value = state === 'hugging' ? POS_RADIUS_HUG : POS_RADIUS
  }

  // ── Shader injection ────────────────────────────────────────────────────────

  applyToScene() {
    this._scene.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) this._injectIntoMaterial(mat)
    })
  }

  _injectIntoMaterial(mat) {
    if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) return
    if (mat._nikoLanternApplied) return
    mat._nikoLanternApplied = true

    const u = this._uniforms

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.posLightPosView   = u.posLightPosView
      shader.uniforms.posLightColor     = u.posLightColor
      shader.uniforms.posLightRadius    = u.posLightRadius
      shader.uniforms.posLightIntensity = u.posLightIntensity
      shader.uniforms.negLightRadius    = u.negLightRadius
      shader.uniforms.negLightIntensity = u.negLightIntensity

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform vec3  posLightPosView;
uniform vec3  posLightColor;
uniform float posLightRadius;
uniform float posLightIntensity;
uniform float negLightRadius;
uniform float negLightIntensity;
void main() {`
      )

      // Both lights share the same orb position (posLightPosView).
      // Positive adds light outward from the orb, negative subtracts near it.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
  vec3  fragPosView = -vViewPosition;
  float orbDist    = length(fragPosView - posLightPosView);

  // positive light
  float posT       = clamp(1.0 - orbDist / posLightRadius, 0.0, 1.0);
  outgoingLight   += posLightColor * posLightIntensity * posT * posT;

  // negative light — same center, smaller radius
  float negT       = clamp(1.0 - orbDist / negLightRadius, 0.0, 1.0);
  outgoingLight   *= max(0.0, 1.0 - negLightIntensity * negT * negT);
}
#include <opaque_fragment>`
      )
    }

    mat.needsUpdate = true
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update() {
    if (!this._nikoMesh || !this._camera) return

    // Get Niko light offset in world space, then transform to view space
    this._nikoMesh.localToWorld(this._lightWorldPos.copy(ORB_OFFSET))
    this._uniforms.posLightPosView.value
      .copy(this._lightWorldPos)
      .applyMatrix4(this._camera.matrixWorldInverse)
  }
}
