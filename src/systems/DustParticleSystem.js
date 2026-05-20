// src/systems/DustParticleSystem.js
// Firefly motes that ARE the light — orbiting the orb, collectively producing
// Niko's glow. Spawn slowly one by one. When the monster has line-of-sight,
// it tears them away: pull scales with proximity, snapping violent up close.

import * as THREE from 'three'

const PARTICLE_COUNT  = 10    // small — each one is precious, visible, meaningful
const ORBIT_RADIUS    = 0.55   // metres — tight cluster around the orb
const SPRING_K        = 2.2    // centripetal spring holding them to the shell
const ORBIT_SPEED     = 1.1    // m/s tangential target speed — maintained by tangential spring
const TANGENTIAL_K    = 4.0    // spring constant restoring tangential speed toward ORBIT_SPEED
const DAMPING         = 0.4    // gentle air resistance — keeps orbits from decaying fast
const WANDER          = 0.6    // small random perturbation — organic wobble
const SPAWN_RATE      = 0.18   // seconds between each new firefly appearing
const PULL_STRENGTH   = 220.0  // monster attractor — violent
const PULL_MAX_DIST   = 30.0   // metres — beyond this, no pull even if in LoS
const HIT_THRESHOLD   = 0.5    // metres to monster — particle absorbed, gone
const BASE_SIZE       = 28.0
const MAX_OPACITY     = 0.95
const FADE_IN_TIME    = 1.2    // seconds to fade in on spawn

// Per-particle PointLight — each firefly IS a real light source in the scene.
// The light travels with the particle, so you physically watch your light leave.
const PARTICLE_LIGHT_INTENSITY = 1.2   // per-particle intensity at full opacity
const PARTICLE_LIGHT_RADIUS    = 6.0   // metres of illumination per particle
const PARTICLE_LIGHT_COLOR     = 0xfff3cc

const COLOR = new THREE.Color(0xfff3cc)  // warm white-yellow, like a firefly

// ─── Shaders ─────────────────────────────────────────────────────────────────

const _vert = /* glsl */`
  uniform  float uSize;
  attribute float aOpacity;
  varying  float vOpacity;
  void main() {
    vOpacity     = aOpacity;
    vec4 mvPos   = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize / -mvPos.z;
    gl_Position  = projectionMatrix * mvPos;
  }
`

const _frag = /* glsl */`
  uniform vec3  uColor;
  varying float vOpacity;
  void main() {
    float d     = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d) * vOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`

// ─── DustParticleSystem ───────────────────────────────────────────────────────

export class DustParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../GameStateMachine/index.js').GameStateMachine} gsm
   */
  constructor(scene, gsm) {
    this._scene        = scene
    this._gsm          = gsm
    this._nikoLight    = null
    this._monster      = null
    this._catacombMesh = null
    this._lightPos     = new THREE.Vector3()
    this._prevLightPos = new THREE.Vector3()
    this._monsterPos   = new THREE.Vector3()
    this._losRay       = new THREE.Raycaster()
    this._losDir       = new THREE.Vector3()
    this._monsterInLoS = false
    this._monsterDist  = Infinity

    // How many fireflies are currently alive (spawned in)
    this._aliveCount   = 0
    this._spawnTimer   = 0
    // Track how many unique slots have ever been spawned.
    // Until all PARTICLE_COUNT have appeared at least once, the light ratio
    // stays at 1.0 — unspawned particles are still in the lantern, not lost.
    this._everSpawned  = 0

    this._px    = new Float32Array(PARTICLE_COUNT)
    this._py    = new Float32Array(PARTICLE_COUNT)
    this._pz    = new Float32Array(PARTICLE_COUNT)
    this._vx    = new Float32Array(PARTICLE_COUNT)
    this._vy    = new Float32Array(PARTICLE_COUNT)
    this._vz    = new Float32Array(PARTICLE_COUNT)
    this._age   = new Float32Array(PARTICLE_COUNT)
    // alive[i]: 1 = orbiting, 0 = dead (stolen by monster)
    this._alive = new Uint8Array(PARTICLE_COUNT)

    this._posBuf = new Float32Array(PARTICLE_COUNT * 3)
    this._opaBuf = new Float32Array(PARTICLE_COUNT)

    // Park all particles at origin until spawned
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._alive[i]  = 0
      this._opaBuf[i] = 0
    }

    const geo = new THREE.BufferGeometry()
    this._posAttr = new THREE.BufferAttribute(this._posBuf, 3)
    this._opaAttr = new THREE.BufferAttribute(this._opaBuf, 1)
    geo.setAttribute('position', this._posAttr)
    geo.setAttribute('aOpacity', this._opaAttr)

    const mat = new THREE.ShaderMaterial({
      vertexShader:   _vert,
      fragmentShader: _frag,
      uniforms: {
        uSize:  { value: BASE_SIZE },
        uColor: { value: COLOR },
      },
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })

    this._points = new THREE.Points(geo, mat)
    this._points.frustumCulled = false
    this._scene.add(this._points)

    // One real PointLight per particle — they move with the sprites, so light
    // physically travels when the monster pulls a particle across the corridor.
    this._particleLights = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const pl = new THREE.PointLight(PARTICLE_LIGHT_COLOR, 0, PARTICLE_LIGHT_RADIUS)
      this._scene.add(pl)
      this._particleLights.push(pl)
    }
  }

  setNikoLight(light)   { this._nikoLight    = light }
  setMonster(obj)       { this._monster      = obj   }
  setCatacombMesh(mesh) { this._catacombMesh = mesh  }

  /**
   * 0–1 fraction of light remaining — this IS sanity.
   * Returns 1.0 during initial spawn-in: unspawned particles are dormant,
   * not consumed, so they don't reduce your light pool.
   * Drops below 1.0 only once all particles have emerged at least once.
   */
  getLightRatio() {
    if (this._everSpawned < PARTICLE_COUNT) return 1.0
    return this._aliveCount / PARTICLE_COUNT
  }

  // Spawn the next dead firefly into orbit
  _spawnNext() {
    // Find first dead slot
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (!this._alive[i]) {
        this._spawnAt(i)
        return
      }
    }
  }

  _spawnAt(i) {
    // Random point on the orbital shell
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const nx    = Math.sin(phi) * Math.cos(theta)
    const ny    = Math.sin(phi) * Math.sin(theta)
    const nz    = Math.cos(phi)

    this._px[i] = this._lightPos.x + nx * ORBIT_RADIUS
    this._py[i] = this._lightPos.y + ny * ORBIT_RADIUS
    this._pz[i] = this._lightPos.z + nz * ORBIT_RADIUS

    // Tangential velocity — perpendicular to radial, gives orbital spin
    // Cross radial with an arbitrary non-parallel axis
    const ax = Math.abs(nx) < 0.9 ? 1 : 0
    const ay = Math.abs(nx) < 0.9 ? 0 : 1
    let tx = ny * 0   - nz * ay
    let ty = nz * ax  - nx * 0
    let tz = nx * ay  - ny * ax
    const td = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
    tx /= td; ty /= td; tz /= td

    this._vx[i] = tx * ORBIT_SPEED
    this._vy[i] = ty * ORBIT_SPEED
    this._vz[i] = tz * ORBIT_SPEED

    this._age[i]   = 0
    this._alive[i] = 1
    this._aliveCount++
    if (this._everSpawned < PARTICLE_COUNT) this._everSpawned++
  }

  /** @param {number} delta seconds */
  update(delta) {
    if (!this._gsm.isActive || !this._nikoLight) return

    this._nikoLight.getWorldPosition(this._lightPos)

    // Translate all alive particles by however far the anchor moved this frame,
    // so they ride with the player instantly instead of chasing via spring lag.
    const ddx = this._lightPos.x - this._prevLightPos.x
    const ddy = this._lightPos.y - this._prevLightPos.y
    const ddz = this._lightPos.z - this._prevLightPos.z
    if (this._aliveCount > 0 && (ddx !== 0 || ddy !== 0 || ddz !== 0)) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (!this._alive[i]) continue
        this._px[i] += ddx
        this._py[i] += ddy
        this._pz[i] += ddz
      }
    }
    this._prevLightPos.copy(this._lightPos)

    // ── Slow spawn — one new firefly every SPAWN_RATE seconds ────────────────
    if (this._aliveCount < PARTICLE_COUNT) {
      this._spawnTimer += delta
      if (this._spawnTimer >= SPAWN_RATE) {
        this._spawnTimer = 0
        this._spawnNext()
      }
    }

    // ── Monster LoS check — one raycast per frame ─────────────────────────────
    if (this._monster) {
      this._monster.getWorldPosition(this._monsterPos)
      this._losDir.subVectors(this._monsterPos, this._lightPos)
      const dist = this._losDir.length()
      this._monsterDist = dist
      this._losDir.divideScalar(dist)
      this._losRay.set(this._lightPos, this._losDir)
      this._losRay.far = dist
      const hits = this._catacombMesh
        ? this._losRay.intersectObject(this._catacombMesh, true)
        : []
      this._monsterInLoS = hits.length === 0 && dist < PULL_MAX_DIST
    } else {
      this._monsterInLoS = false
      this._monsterDist  = Infinity
    }

    const damp = Math.exp(-DAMPING * delta)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (!this._alive[i]) {
        this._opaBuf[i]             = 0
        this._posBuf[i * 3]         = this._lightPos.x
        this._posBuf[i * 3 + 1]     = this._lightPos.y
        this._posBuf[i * 3 + 2]     = this._lightPos.z
        this._particleLights[i].intensity = 0
        continue
      }

      this._age[i] += delta

      // ── Damping ───────────────────────────────────────────────────────────
      this._vx[i] *= damp
      this._vy[i] *= damp
      this._vz[i] *= damp

      // ── Organic wander ────────────────────────────────────────────────────
      this._vx[i] += (Math.random() - 0.5) * WANDER * delta
      this._vy[i] += (Math.random() - 0.5) * WANDER * delta
      this._vz[i] += (Math.random() - 0.5) * WANDER * delta

      // ── Bidirectional spring to orbital shell — centripetal force ─────────
      const ox = this._px[i] - this._lightPos.x
      const oy = this._py[i] - this._lightPos.y
      const oz = this._pz[i] - this._lightPos.z
      const od = Math.sqrt(ox * ox + oy * oy + oz * oz) || 0.001
      const springF = (od - ORBIT_RADIUS) * SPRING_K
      const rx = ox / od, ry = oy / od, rz = oz / od
      this._vx[i] -= rx * springF * delta
      this._vy[i] -= ry * springF * delta
      this._vz[i] -= rz * springF * delta

      // ── Tangential speed spring — keeps visible orbiting alive ────────────
      // Project velocity onto radial axis, remainder is tangential.
      const vDotR = this._vx[i] * rx + this._vy[i] * ry + this._vz[i] * rz
      const tvx = this._vx[i] - vDotR * rx
      const tvy = this._vy[i] - vDotR * ry
      const tvz = this._vz[i] - vDotR * rz
      const tSpeed = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz) || 0.001
      const tForce = (ORBIT_SPEED - tSpeed) * TANGENTIAL_K * delta
      this._vx[i] += (tvx / tSpeed) * tForce
      this._vy[i] += (tvy / tSpeed) * tForce
      this._vz[i] += (tvz / tSpeed) * tForce

      // ── Monster pull — LoS gated, proximity scaled, uncapped ─────────────
      if (this._monsterInLoS) {
        const mx  = this._monsterPos.x - this._px[i]
        const my  = this._monsterPos.y - this._py[i]
        const mz  = this._monsterPos.z - this._pz[i]
        const md2 = mx * mx + my * my + mz * mz
        const md  = Math.sqrt(md2)

        if (md < HIT_THRESHOLD) {
          // Firefly absorbed by the monster — permanently gone until monster leaves
          this._alive[i]  = 0
          this._aliveCount--
          this._opaBuf[i] = 0
          this._particleLights[i].intensity = 0
          continue
        }

        const proximityScale = 1.0 - this._monsterDist / PULL_MAX_DIST
        const pull = PULL_STRENGTH * proximityScale / md2
        this._vx[i] += (mx / md) * pull * delta
        this._vy[i] += (my / md) * pull * delta
        this._vz[i] += (mz / md) * pull * delta
      }

      // ── Integrate ─────────────────────────────────────────────────────────
      this._px[i] += this._vx[i] * delta
      this._py[i] += this._vy[i] * delta
      this._pz[i] += this._vz[i] * delta

      // ── Opacity — fade in on birth; full brightness once alive ────────────
      const fadeIn        = Math.min(this._age[i] / FADE_IN_TIME, 1.0)
      this._opaBuf[i]     = fadeIn * MAX_OPACITY

      this._posBuf[i * 3]     = this._px[i]
      this._posBuf[i * 3 + 1] = this._py[i]
      this._posBuf[i * 3 + 2] = this._pz[i]

      // ── Per-particle light — follows the sprite exactly ───────────────────
      this._particleLights[i].intensity = PARTICLE_LIGHT_INTENSITY * fadeIn
      this._particleLights[i].position.set(this._px[i], this._py[i], this._pz[i])
    }

    this._posAttr.needsUpdate = true
    this._opaAttr.needsUpdate = true
  }

  dispose() {
    this._scene.remove(this._points)
    this._points.geometry.dispose()
    this._points.material.dispose()
    for (const pl of this._particleLights) {
      this._scene.remove(pl)
      pl.dispose()
    }
  }
}
