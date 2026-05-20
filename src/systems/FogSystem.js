// src/systems/FogSystem.js
// Layered horror fog: base FogExp2 + height-based pooling + animated FBM noise drift.
// Apply to any root mesh after materials are finalized; uniforms animate each frame.

import * as THREE from 'three'

const FOG_COLOR        = 0x0c0d12   // near-black cold blue; matches backdrop behind geometry
const FOG_BASE_DENSITY = 0.4      // starts ~10m, mostly consumed ~25m

// ─── Vertex chunks ────────────────────────────────────────────────────────────
// Adds world-space Y and XZ varyings so the fragment shader can do height fog + noise.

const FOG_PARS_VERTEX = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogWorldY;
  varying vec2  vFogWorldXZ;
#endif
`

const FOG_VERTEX = /* glsl */`
#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
  {
    vec4 _wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      _wp = instanceMatrix * _wp;
    #endif
    _wp = modelMatrix * _wp;
    vFogWorldY  = _wp.y;
    vFogWorldXZ = _wp.xz;
  }
#endif
`

// ─── Fragment chunks ──────────────────────────────────────────────────────────

const FOG_PARS_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  uniform vec3  fogColor;
  varying float vFogDepth;
  varying float vFogWorldY;
  varying vec2  vFogWorldXZ;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  uniform float fogTime;     // animated seconds, wraps
  uniform float fogSanity;   // 1 = sane, 0 = insane; increases density when low

  // ── Smooth value noise (2D) ──────────────────────────────────────────────
  float _fhash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float _fnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(_fhash(i),              _fhash(i + vec2(1.0, 0.0)), f.x),
      mix(_fhash(i + vec2(0.0, 1.0)), _fhash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  // 2-octave FBM — cheap, enough for drifting wisps
  float _ffbm(vec2 p) {
    return 0.6 * _fnoise(p) + 0.4 * _fnoise(p * 2.1 + vec2(5.2, 1.3));
  }
#endif
`

// Height fog: density is max at floor (Y≈0), falls off exponentially upward.
// Noise drift: FBM animates slowly in XZ to create drifting wisps.
// Sanity hook: low sanity thickens fog by up to +50%.
const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  // Height falloff — fog pools at floor, thins toward ceiling
  float _heightFactor = exp(-max(vFogWorldY, 0.0) * 1.0);
  float _densityMod   = 0.3 + 0.7 * _heightFactor;  // 0.3 at ceiling, 1.0 at floor

  // FBM noise drift — very slow so it reads as "breathing" mist
  vec2 _nc = vFogWorldXZ * 0.07 + vec2(fogTime * 0.020, fogTime * 0.013);
  float _drift    = _ffbm(_nc);
  float _noiseMod = 0.75 + _drift * 0.50;  // ±25% around base

  // Sanity ramps density up as player loses it
  float _sanityBoost = 1.0 + (1.0 - fogSanity) * 0.5;

  float _d = fogDensity * _densityMod * _noiseMod * _sanityBoost;
  float fogFactor = 1.0 - exp(-_d * _d * vFogDepth * vFogDepth);
  fogFactor = clamp(fogFactor, 0.0, 1.0);

  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`

// ─── FogSystem ────────────────────────────────────────────────────────────────

export class FogSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(scene, gsm) {
    this._scene = scene
    this._gsm   = gsm
    this._time  = 0

    // Shared uniforms — all patched materials reference the same objects,
    // so a single update per frame propagates to every material.
    this._uniforms = {
      fogTime:   { value: 0.0 },
      fogSanity: { value: 1.0 },
    }

    // Base scene fog — Three.js automatically applies this to standard materials
    // AND drives the fogColor / fogDensity uniforms injected by our custom chunks.
    this._scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_BASE_DENSITY)

    // Match background so distant/empty areas blend seamlessly with the fog.
    this._scene.background = new THREE.Color(FOG_COLOR)
  }

  /**
   * Traverse a root Object3D and patch every eligible MeshStandardMaterial
   * with the height-fog + noise shader. Call after all materials are finalized.
   * @param {THREE.Object3D} root
   */
  applyFogToMesh(root) {
    root.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) {
        // Skip subtractive/additive overlays — they're blended differently and
        // don't need or benefit from fog.
        if (mat.blending !== THREE.NormalBlending) continue
        this._patchMaterial(mat)
      }
    })
  }

  /** @param {THREE.Material} mat */
  _patchMaterial(mat) {
    const u = this._uniforms
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.fogTime   = u.fogTime
      shader.uniforms.fogSanity = u.fogSanity

      shader.vertexShader = shader.vertexShader
        .replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX)
        .replace('#include <fog_vertex>',      FOG_VERTEX)

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
        .replace('#include <fog_fragment>',      FOG_FRAGMENT)
    }
    // Force recompile if the material was already compiled without our chunks.
    mat.needsUpdate = true
  }

  /**
   * Per-frame update — animate time and read sanity.
   * GSM calls this automatically via the registered systems loop.
   * @param {number} delta - seconds
   */
  update(delta) {
    this._time = (this._time + delta) % 1000.0
    this._uniforms.fogTime.value   = this._time
    this._uniforms.fogSanity.value = this._gsm.systems.sanity?.getSanity?.() ?? 1.0
  }
}
