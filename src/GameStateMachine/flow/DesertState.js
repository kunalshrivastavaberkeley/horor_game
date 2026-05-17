export class DesertState {
  enter(gsm) {
    gsm.setGameActive(true)
    // Notify systems that we're in DESERT zone
    if (gsm.systems.audio) gsm.systems.audio.onStateChange('DESERT')
    if (gsm.systems.player && gsm.camera) gsm.systems.player.setCamera(gsm.camera)
    if (gsm.systems.lighting) gsm.systems.lighting.setCamera(gsm.camera)
  }

  update(_gsm, _delta) {}

  exit(gsm) {
    gsm.setGameActive(false)
    if (gsm.systems.player) gsm.systems.player.releaseCamera()
    if (gsm.systems.lighting) gsm.systems.lighting.releaseCamera()
  }
}
