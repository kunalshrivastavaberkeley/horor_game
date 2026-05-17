export class EndState {
  enter(gsm) {
    gsm.setGameActive(false)
    if (gsm.systems.audio) gsm.systems.audio.onStateChange('END')

    this._overlay = document.createElement('div')
    Object.assign(this._overlay.style, {
      position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.9)', color: '#fff', fontSize: '2rem',
      zIndex: '100', fontFamily: 'serif'
    })
    this._overlay.innerHTML = '<div style="letter-spacing:.2em">GAME OVER</div><button id="restart-btn" style="margin-top:1.5rem;font-size:1rem;padding:.5rem 2rem;background:#222;color:#fff;border:1px solid #555;cursor:pointer">Restart</button>'
    document.body.appendChild(this._overlay)
    document.getElementById('restart-btn').addEventListener('click', () => location.reload())
  }

  update(_gsm, _delta) {}

  exit(_gsm) {
    this._overlay?.remove()
  }
}
