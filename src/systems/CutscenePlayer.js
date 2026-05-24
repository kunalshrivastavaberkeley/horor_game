import * as THREE from 'three'

function smoothstep(t) { return t * t * (3 - 2 * t) }

function lerpYaw(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  return a + d * t
}

// Evaluate cubic bezier at local t∈[0,1], write result into `out`
function cubicBezier(p0, p1, p2, p3, t, out) {
  const s = 1 - t
  const a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t
  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x
  out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y
  out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z
}

export class CutscenePlayer {
  constructor() {
    this._camera    = null
    this._waypoints = []
    this._totalTime = 0
    this._t         = 0
    this._active    = false
    this._onDone    = null
  }

  static async loadPath(name) {
    try {
      const res = await fetch(`/data/paths/${name}.json`)
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  setPath(waypoints) {
    this._waypoints = waypoints
    this._totalTime = waypoints.length >= 2 ? waypoints[waypoints.length - 1].time : 0
  }

  play(camera, onDone) {
    if (this._waypoints.length < 2) { onDone?.(); return }
    this._camera = camera
    this._t      = 0
    this._active = true
    this._onDone = onDone
    this._applyAtTime(0)
  }

  tick(delta) {
    if (!this._active) return
    this._t += delta
    if (this._t >= this._totalTime) {
      this._applyAtTime(this._totalTime)
      this._active = false
      this._onDone?.()
      return
    }
    this._applyAtTime(this._t)
  }

  skip() {
    if (!this._active) return
    this._active = false
    this._applyAtTime(this._totalTime)
    this._onDone?.()
  }

  get isPlaying()  { return this._active }
  get totalTime()  { return this._totalTime }
  get hasPath()    { return this._waypoints.length >= 2 }

  // ─── Private ────────────────────────────────────────────────────────────────

  _applyAtTime(t) {
    const wps = this._waypoints

    // Find segment [i, i+1]
    let i = wps.length - 2
    for (let j = 0; j < wps.length - 1; j++) {
      if (t <= wps[j + 1].time) { i = j; break }
    }

    const wa = wps[i], wb = wps[i + 1]
    const segLen = wb.time - wa.time
    const alpha  = segLen > 0 ? smoothstep(Math.min(1, (t - wa.time) / segLen)) : 1

    // Bezier control points — fall back to waypoint position if handles absent
    const p0 = wa
    const p1 = wa.handleOut ?? wa
    const p3 = wb
    const p2 = wb.handleIn  ?? wb

    cubicBezier(p0, p1, p2, p3, alpha, this._camera.position)

    this._camera.rotation.order = 'YXZ'
    this._camera.rotation.y = lerpYaw(wa.yaw, wb.yaw, alpha)
    this._camera.rotation.x = wa.pitch + (wb.pitch - wa.pitch) * alpha
  }
}
