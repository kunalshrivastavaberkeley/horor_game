// src/nikoConfig.js
// ─── Single source of truth for all Niko / arm / bulb positioning ────────────
// Edit this file to tune how Niko looks and moves. No other file needs touching.

export const NIKO = {

  // ── Model ─────────────────────────────────────────────────────────────────
  scale: 0.2,

  // ── Held position (default — Niko extended out, facing away) ─────────────
  heldFwd:   0.8,   // forward distance from camera
  heldRight: 0.2,   // lateral offset (positive = right)
  heldUp:   -0.5,   // vertical offset (negative = below eye)

  // ── Hug position (E pressed — Niko pulled in, facing you) ────────────────
  hugFwd:    0.3,
  hugRight:  0.00,
  hugUp:    -0.8,

  // ── Path arc — Bezier control point offset from the held↔hug midpoint ────
  arcRight: -0.1,   // rightward bulge (negative = leftward / outward)
  arcDown:  -0.1,   // downward bulge (negative = down)

  // ── Transition ────────────────────────────────────────────────────────────
  lerpSpeed: 8.0,

  // ── Lightbulb (local offset inside Niko's model space) ────────────────────
  bulbScale: 2.0,
  bulbX: 0,
  bulbY: 1,
  bulbZ: 1,

  // ── Hand billboard (offset from Niko's world position, camera-relative) ───
  // thumbScale / fingersScale size each sprite independently.
  // handRight/Up/Fwd control the shared anchor point — both sprites go here.
  thumbScale:   0.9,  // world-space size of the thumb sprite (renders IN FRONT of Niko)
  fingersScale: 0.9,  // world-space size of the fingers sprite (renders BEHIND Niko)
  handRight:    0.2,   // shift right relative to camera facing
  handUp:      -0.24,  // shift down
  handFwd:     0.0,  // shift toward/away from camera (negative = closer to player)

}
    