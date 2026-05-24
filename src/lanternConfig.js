// src/lanternConfig.js
// Single source of truth for lantern / arm positioning.

export const LANTERN = {

  // ── Model ─────────────────────────────────────────────────────────────────
  scale: 0.2,

  // ── Held position (default — lantern extended out, facing away) ───────────
  heldFwd:   0.8,
  heldRight: 0.2,
  heldUp:   -0.5,

  // ── Hug position (E pressed — lantern pulled in, facing you) ─────────────
  hugFwd:    0.3,
  hugRight:  0.00,
  hugUp:    -0.8,

  // ── Path arc — Bezier control point offset from the held↔hug midpoint ────
  arcRight: -0.1,
  arcDown:  -0.1,

  // ── Transition ────────────────────────────────────────────────────────────
  lerpSpeed: 8.0,

}
