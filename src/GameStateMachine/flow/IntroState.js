// Enter: Run intro sequence (waking up on the floor, find the lantern, pick up)
// Running: IntroSequence ticks each frame
// Exit: Sequence already cleaned itself up; nothing to do
//
// Dev skip: Space at any time jumps straight to PLAY (the catacomb).
// To bypass intro entirely during dev, set DEV_SKIP = true below.

const DEV_SKIP = true

export class IntroState {
  enter(gsm) {
    if (DEV_SKIP) {
      gsm.transition('PLAY')
      return
    }

    gsm.systems.player?.initCollision()

    const seq = gsm.introSequence
    if (!seq) { console.error('[IntroState] No introSequence on gsm'); gsm.transition('PLAY'); return }

    seq.start(() => gsm.transition('PLAY'))
    this._seq = seq
  }

  update(gsm, delta) {
    this._seq?.tick(delta)
  }

  exit(_gsm) {
    this._seq = null
  }
}
