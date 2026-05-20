// src/systems/PostProcessing.js
// EffectComposer + custom GLSL shader for sanity effects.
// Leaf node — no outputs.

import * as THREE from 'three'
import { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }       from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass }       from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass }  from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

// Bloom tuning — particles and the Niko bulb should glow; walls should not
const BLOOM_STRENGTH  = 0.1   // intensity of the glow
const BLOOM_RADIUS    = 0.6   // how far the glow spreads
const BLOOM_THRESHOLD = 0.15  // luminance cutoff — only bright objects bloom

const TIME_WRAP = 1000.0 // wrap time uniform at this value

// Custom GLSL fragment shader — all effects in one pass
const SanityShader = {
  uniforms: {
    tDiffuse:     { value: null },
    sanityFloat:  { value: 0.0 },   // 0 = full sanity, 1 = insane (inverted internally)
    blackOverlay: { value: 0.0 },   // 0 = transparent, 1 = fully black
    time:         { value: 0.0 },   // accumulated seconds, wraps at TIME_WRAP
    shakeOffset:  { value: new THREE.Vector2(0, 0) },  // UV displacement for shake
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float sanityFloat;
    uniform float blackOverlay;
    uniform float time;
    uniform vec2 shakeOffset;
    varying vec2 vUv;

    // Pseudo-random noise seeded by position + time
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      float inv = sanityFloat;  // 0 = sane (no effects), 1 = fully insane

      // Apply shake UV offset
      vec2 uv = vUv + shakeOffset;

      // UV warp — sin/cos displacement scaled by insanity
      uv.x += sin(uv.y * 8.0 + time * 0.7) * inv * 0.015;
      uv.y += cos(uv.x * 6.0 + time * 0.5) * inv * 0.010;

      // Screen sway — low-amplitude continuous roll
      uv.x += sin(time * 0.4) * inv * 0.005;
      uv.y += cos(time * 0.3) * inv * 0.003;

      vec4 col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
      col.a = 1.0;

      // Desaturation — lerp toward grayscale
      float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(lum), inv * 0.6);

      // Film grain — noise seeded by UV + time
      float grain = (rand(uv + time * 0.01) - 0.5) * inv * 0.08;
      col.rgb += grain;
      col.rgb = clamp(col.rgb, 0.0, 1.0);

      // Black overlay — additive on top of all effects (hug sequence)
      col.rgb = mix(col.rgb, vec3(0.0), blackOverlay);

      gl_FragColor = col;
    }
  `
}

export class PostProcessing {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(renderer, scene, camera, gsm) {
    this._renderer = renderer
    this._scene    = scene
    this._camera   = camera
    this._gsm      = gsm

    this._composer = new EffectComposer(renderer)

    this._renderPass = new RenderPass(scene, camera)
    this._composer.addPass(this._renderPass)

    this._bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    this._composer.addPass(this._bloomPass)

    this._shaderPass = new ShaderPass(SanityShader)
    this._shaderPass.renderToScreen = true
    this._composer.addPass(this._shaderPass)

    this._time = 0
  }

  /**
   * Called when GSM changes the active camera (e.g. on DESERT/TEMPLE enter).
   * @param {THREE.Camera} cam
   */
  setCamera(cam) {
    this._camera = cam
    this._renderPass.camera = cam
  }

  // ─── Main update + render ─────────────────────────────────────────────────────

  /**
   * @param {number} delta - seconds
   */
  update(delta) {
    if (!this._gsm.isActive) return

    this._time = (this._time + delta) % TIME_WRAP
    this._shaderPass.uniforms.time.value = this._time

    const sanity = this._gsm.systems.sanity?.getSanity() ?? 1
    this._shaderPass.uniforms.sanityFloat.value = 1.0 - sanity

    // Bloom strength scales with light level — fewer particles = weaker glow
    this._bloomPass.strength = BLOOM_STRENGTH * sanity
  }

  /**
   * Render the composed output to screen. Call instead of renderer.render().
   */
  render() {
    this._composer.render()
  }

  /**
   * Update composer size on window resize.
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    this._composer.setSize(width, height)
  }
}
