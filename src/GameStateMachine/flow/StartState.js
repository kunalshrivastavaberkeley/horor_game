// Enter: Show start screen overlay, listen for click
// Running: Wait for user interaction
// Exit: Remove overlay

export class StartState {
  enter(gsm) {
    this._overlay = document.createElement('div')
    Object.assign(this._overlay.style, {
      position: 'fixed', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: '#000', color: '#fff', fontSize: '2rem',
      cursor: 'pointer', zIndex: '100', fontFamily: 'serif',
      letterSpacing: '0.2em'
    })
    this._overlay.textContent = 'PRESS TO START'
    document.body.appendChild(this._overlay)
    this._onClick = () => gsm.transition('INTRO')
    this._overlay.addEventListener('click', this._onClick)
  }

  update(_gsm, _delta) {}

  exit(_gsm) {
    this._overlay.removeEventListener('click', this._onClick)
    this._overlay.remove()
  }
}
