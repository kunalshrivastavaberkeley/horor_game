export class ExitState {
  enter(gsm) {
    gsm.setGameActive(true)
    if (gsm.systems.audio) gsm.systems.audio.onStateChange('DESERT')
  }

  update(_gsm, _delta) {}

  exit(gsm) {
    gsm.setGameActive(false)
  }
}
