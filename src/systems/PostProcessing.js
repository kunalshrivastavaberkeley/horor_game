import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js'

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// 16-sample directional blur along the camera's screen-space velocity vector.
// velocity is in UV units (0–1), computed from angular camera delta each frame.
const FRAG = /* glsl */`
  #define SAMPLES 16
  uniform sampler2D tDiffuse;
  uniform vec2      velocity;
  varying vec2      vUv;

  void main() {
    vec4 color = vec4(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      float t  = float(i) / float(SAMPLES - 1) - 0.5;
      color   += texture2D(tDiffuse, clamp(vUv + velocity * t, 0.0, 1.0));
    }
    gl_FragColor = color / float(SAMPLES);
  }
`

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this._camera   = camera
    this._composer = new EffectComposer(renderer)

    this._blurPass = new ShaderPass({
      uniforms:       { tDiffuse: { value: null }, velocity: { value: new THREE.Vector2() } },
      vertexShader:   VERT,
      fragmentShader: FRAG,
    })
    this._blurPass.enabled = false

    this._composer.addPass(new RenderPass(scene, camera))
    this._composer.addPass(this._blurPass)

    this._prevEuler = new THREE.Euler()
    this._intensity = 2.0
    this.isActive   = false
  }

  setMotionBlur(enabled, intensity = 2.0) {
    if (enabled) {
      this._intensity = intensity
      this._prevEuler.setFromQuaternion(this._camera.quaternion, 'YXZ')
      this._blurPass.enabled = true
      this.isActive = true
    } else {
      this._blurPass.uniforms.velocity.value.set(0, 0)
      this._blurPass.enabled = false
      this.isActive = false
    }
  }

  update() {
    if (!this._blurPass.enabled) return

    const e   = new THREE.Euler().setFromQuaternion(this._camera.quaternion, 'YXZ')
    const thf = Math.tan(this._camera.fov * (Math.PI / 360))  // tan(half-fov)

    this._blurPass.uniforms.velocity.value.set(
      -(e.y - this._prevEuler.y) / thf * this._intensity,
       (e.x - this._prevEuler.x) / thf * this._intensity,
    )

    this._prevEuler.copy(e)
  }

  render() { this._composer.render() }

  setSize(w, h) { this._composer.setSize(w, h) }
}
