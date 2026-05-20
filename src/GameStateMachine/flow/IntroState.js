// Enter: Spin up systems, cutscene placeholder (auto-advances)
// Running: Wait for intro complete
// Exit: Transition to DesertState

export class IntroState {
  enter(gsm) {
    // Stub: auto-advance after 500ms so game is playable immediately
    // Decision: no assets yet, so skip straight to DESERT
    this._timer = setTimeout(() => gsm.transition('DESERT'), 0)
  }

  update(_gsm, _delta) {}

  exit(_gsm) {
    clearTimeout(this._timer)
  }
}
