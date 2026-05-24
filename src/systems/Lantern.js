// src/systems/Lantern.js
//
// Lighting model:
//   Pass 1 — Lantern (positive): gaussian falloff from orb, occluded by a
//             hemisphere shadow map rendered from the orb each frame.
//   Pass 2 — Crawl (negative): multiplies away geometry close to the camera,
//             hiding close-up surfaces.
//
// Shadow technique: single perspective frustum (hemisphere forward of player).
//   - 1 depth render pass per frame with scene.overrideMaterial.
//   - PCF 3x3 kernel with NdotL-based bias (LearnOpenGL standard).
//   - Fragments outside the shadow frustum are assumed fully lit.
//   - shadowMin prevents pitch-black shadows.

import * as THREE from 'three'

const POS_COLOR      = new THREE.Color(0xffdd88)
const POS_INTENSITY  = 2.0
const POS_RADIUS     = 7.0
const ORB_OFFSET     = new THREE.Vector3(0, 1, 0)

const CRAWL_RADIUS    = 2.0
const CRAWL_INTENSITY = 1.0

const SHADOW_SIZE = 1024
const SHADOW_NEAR = 0.1
const SHADOW_FAR  = 20.0
const SHADOW_FOV  = 90

export class Lantern {
  constructor(scene, camera, renderer) {
    this._scene    = scene
    this._camera   = camera
    this._renderer = renderer

    this._lanternMesh   = null
    this._lightWorldPos = new THREE.Vector3()

    this._uniforms = {
      posLightPosView:  { value: new THREE.Vector3() },
      posLightColor:    { value: POS_COLOR.clone() },
      posLightRadius:   { value: POS_RADIUS },
      posLightIntensity:{ value: POS_INTENSITY },
      posNdotL:         { value: 1.0 },
      crawlRadius:      { value: CRAWL_RADIUS },
      crawlIntensity:   { value: CRAWL_INTENSITY },
      crawlNdotL:       { value: 0.0 },
      shadowMap:        { value: null },
      shadowMatrix:     { value: new THREE.Matrix4() },
      cameraWorldMatrix:{ value: new THREE.Matrix4() },
      shadowNear:       { value: SHADOW_NEAR },
      shadowFar:        { value: SHADOW_FAR },
      shadowMin:        { value: 0.2 },
    }

    // Depth-only render target — hardware depth written automatically to depthTexture
    this._shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })
    this._shadowTarget.depthTexture             = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE)
    this._shadowTarget.depthTexture.type        = THREE.UnsignedShortType
    this._shadowTarget.depthTexture.format      = THREE.DepthFormat
    this._uniforms.shadowMap.value              = this._shadowTarget.depthTexture

    // Perspective shadow camera — 90° FOV covers the forward hemisphere
    this._shadowCam = new THREE.PerspectiveCamera(SHADOW_FOV, 1, SHADOW_NEAR, SHADOW_FAR)
    this._scene.add(this._shadowCam)

    // Override material for the shadow depth pass — avoids full PBR per fragment
    this._depthMaterial = new THREE.MeshDepthMaterial()

    this._helperMesh = null
  }

  // ── Setup ────────────────────────────────────────────────────────────────────

  attachToMesh(mesh) {
    this._lanternMesh = mesh
    this._helperMesh  = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffdd88, wireframe: true })
    )
    this._helperMesh.position.copy(ORB_OFFSET)
    mesh.add(this._helperMesh)
  }

  setOrbPosition(x, y, z) {
    ORB_OFFSET.set(x, y, z)
    if (this._helperMesh) this._helperMesh.position.set(x, y, z)
  }

  setHelperVisible(v) {
    if (this._helperMesh) this._helperMesh.visible = v
  }

  // ── Shader injection ─────────────────────────────────────────────────────────

  applyToScene() {
    this._scene.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) this._injectIntoMaterial(mat)
    })
  }

  _injectIntoMaterial(mat) {
    if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) return
    if (mat._lanternApplied) return
    mat._lanternApplied = true

    const u = this._uniforms

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.posLightPosView   = u.posLightPosView
      shader.uniforms.posLightColor     = u.posLightColor
      shader.uniforms.posLightRadius    = u.posLightRadius
      shader.uniforms.posLightIntensity = u.posLightIntensity
      shader.uniforms.posNdotL          = u.posNdotL
      shader.uniforms.crawlRadius       = u.crawlRadius
      shader.uniforms.crawlIntensity    = u.crawlIntensity
      shader.uniforms.crawlNdotL        = u.crawlNdotL
      shader.uniforms.shadowMap         = u.shadowMap
      shader.uniforms.shadowMatrix      = u.shadowMatrix
      shader.uniforms.cameraWorldMatrix = u.cameraWorldMatrix
      shader.uniforms.shadowNear        = u.shadowNear
      shader.uniforms.shadowFar         = u.shadowFar
      shader.uniforms.shadowMin         = u.shadowMin

      // ── Declarations + shadow function ────────────────────────────────────────
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform vec3      posLightPosView;
uniform vec3      posLightColor;
uniform float     posLightRadius;
uniform float     posLightIntensity;
uniform float     posNdotL;
uniform float     crawlRadius;
uniform float     crawlIntensity;
uniform float     crawlNdotL;
uniform sampler2D shadowMap;
uniform mat4      shadowMatrix;
uniform mat4      cameraWorldMatrix;
uniform float     shadowNear;
uniform float     shadowFar;
uniform float     shadowMin;

// PCF 3x3 hemisphere shadow map.
// fragPosView : fragment in view space  (= -vViewPosition)
// NdotL       : cos angle to lantern, used for bias
float lanternShadow(vec3 fragPosView, float NdotL) {
  // View → world (cameraWorldMatrix is camera.matrixWorld, the inverse of viewMatrix)
  vec4 worldPos  = cameraWorldMatrix * vec4(fragPosView, 1.0);
  vec4 lightClip = shadowMatrix * worldPos;

  // Behind shadow camera → assume fully lit
  if (lightClip.w <= 0.0) return 1.0;

  vec3 ndc = lightClip.xyz / lightClip.w;

  // Outside frustum (hemisphere sides / back) → assume fully lit
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0 || ndc.z < -1.0) return 1.0;

  // NDC → UV [0,1] and depth [0,1] — matches depth texture storage
  vec2  uv           = ndc.xy * 0.5 + 0.5;
  float currentDepth = ndc.z  * 0.5 + 0.5;

  // NdotL-based bias: larger on grazing angles where acne is worst
  float bias = max(0.02 * (1.0 - NdotL), 0.003);

  // PCF 3x3 — 9 samples, one texel apart
  float shadow    = 0.0;
  vec2  texelSize = vec2(1.0 / ${SHADOW_SIZE}.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float mapDepth = texture2D(shadowMap, uv + vec2(float(x), float(y)) * texelSize).r;
      shadow += (currentDepth - bias > mapDepth) ? 1.0 : 0.0;
    }
  }
  shadow /= 9.0; // 0 = fully lit, 1 = fully shadowed

  // shadowMin keeps shadowed areas from going pitch black
  return mix(shadowMin, 1.0, 1.0 - shadow);
}

void main() {`
      )

      // ── Light calculation (replaces opaque_fragment) ──────────────────────────
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
  vec3  fragPosView = -vViewPosition;
  vec3  lightDir    = normalize(posLightPosView - fragPosView);
  float orbDist     = length(posLightPosView - fragPosView);
  float NdotL       = max(0.0, dot(normal, lightDir));

  float shadow = lanternShadow(fragPosView, NdotL);

  // Pass 1 — lantern: gaussian falloff from orb, attenuated by shadow
  float posAtten  = exp(-(orbDist * orbDist) / (posLightRadius * posLightRadius));
  float posAngle  = mix(1.0, NdotL, posNdotL);
  outgoingLight  += posLightColor * posLightIntensity * posAtten * posAngle * shadow;

  // Pass 2 — crawl: darkens surfaces close to the camera independently of lantern
  float camDist    = length(fragPosView);
  vec3  crawlDir   = camDist > 0.001 ? (-fragPosView / camDist) : vec3(0.0, 0.0, -1.0);
  float crawlNdotLv = max(0.0, dot(normal, crawlDir));
  float crawlAngle = mix(1.0, crawlNdotLv, crawlNdotL);
  float crawlAtten = exp(-(camDist * camDist) / (crawlRadius * crawlRadius));
  outgoingLight   *= max(0.0, 1.0 - crawlIntensity * crawlAtten * crawlAngle);
}
#include <opaque_fragment>`
      )
    }

    mat.needsUpdate = true
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────

  update() {
    if (!this._camera || !this._renderer) return

    // Resolve orb world position
    if (this._lanternMesh) {
      this._lanternMesh.localToWorld(this._lightWorldPos.copy(ORB_OFFSET))
    } else {
      this._lightWorldPos.set(0.5, -0.3, -1.2)
      this._lightWorldPos.applyQuaternion(this._camera.quaternion)
      this._lightWorldPos.add(this._camera.position)
    }

    // View-space orb position for the lighting uniforms
    this._uniforms.posLightPosView.value
      .copy(this._lightWorldPos)
      .applyMatrix4(this._camera.matrixWorldInverse)

    // Pass the camera world matrix so the shader can go view → world without inverse()
    this._uniforms.cameraWorldMatrix.value.copy(this._camera.matrixWorld)

    // Position the shadow camera at the orb, aimed in the player camera's direction
    this._shadowCam.position.copy(this._lightWorldPos)
    this._shadowCam.quaternion.copy(this._camera.quaternion)
    this._shadowCam.updateMatrixWorld()

    // shadowMatrix: world → light NDC  (used in the shader to project fragments)
    this._uniforms.shadowMatrix.value
      .multiplyMatrices(this._shadowCam.projectionMatrix, this._shadowCam.matrixWorldInverse)

    // ── Shadow depth pass ──────────────────────────────────────────────────────
    // Override all materials with a plain depth material — no PBR cost per fragment.
    // The GPU writes hardware depth to depthTexture automatically as a side effect.
    const prevTarget = this._renderer.getRenderTarget()

    this._scene.overrideMaterial = this._depthMaterial
    this._renderer.setRenderTarget(this._shadowTarget)
    this._renderer.clear()
    this._renderer.render(this._scene, this._shadowCam)
    this._scene.overrideMaterial = null

    this._renderer.setRenderTarget(prevTarget)
  }
}
