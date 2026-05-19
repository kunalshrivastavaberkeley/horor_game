# Audio Manager — Architecture Spec

## Role
Sub-orchestrator sitting under the Game State Machine. Single source of truth for all audio in the game. Has its own state awareness — knows which audio state it's in and manages all transitions internally. Nothing plays outside of this system.

---

## Core Philosophy
- **Never silence** — every game state has audio. Silence is a failure state.
- **Transitions are always bridged** — no hard cuts between states except SETTINGS.
- **Asset-light, modulation-heavy** — few raw files, processed and modulated to create variety.
- **Single config block** — all tunable values live in one place, named by intent not implementation.
- **Editable by natural language** — built so Claude Code can make changes from plain descriptions without audio engineering knowledge.

---

## Three Simultaneous Layers

| Layer | Job | Behavior |
|---|---|---|
| **Scene** | Always-running ambient | Loops continuously. Crossfades on state change. Never stops except SETTINGS. |
| **Transition** | Bridges state changes | Fires temporarily during state change, then dissolves. |
| **Action** | Player and UI events | One-shot sounds triggered on top of whatever scene is running. |

---

## Audio States

| State | Scene Layer Audio | Sanity Distortion |
|---|---|---|
| `MENU` | Menu ambient — dreary, slow, atmospheric | Off |
| `SETTINGS` | Silent — hard stop | Off |
| `INTRO` | Intro cinematic audio | Off |
| `DESERT` | Desert ambient — open, wind, eerie | Off |
| `TEMPLE` | Temple ambient — enclosed, low hum, oppressive | **On** |
| `END` | End audio — resolving but not safe | Off |

---

## Transition Map

| Transition | Behavior |
|---|---|
| `MENU → INTRO` | Crossfade |
| `INTRO → DESERT` | Crossfade |
| `DESERT → TEMPLE` | Crossfade |
| `TEMPLE → END` | Crossfade |
| `ANY → SETTINGS` | Hard stop — immediate silence |
| `SETTINGS → previous state` | Fade back in to where it left off |

---

## Action Events
Fire on top of the scene layer in any state.

| Event | Notes |
|---|---|
| `footstep` | 2 variations — alternates to avoid repetition |
| `niko_pickup` | Soft, small |
| `niko_putdown` | Soft, small |
| `niko_hug` | Warm, brief |
| `ui_button` | Subtle click |

---

## Sanity Distortion
- **Active in TEMPLE only**
- Modulates all active audio channels — scene layer, action layer
- Driven by sanity float (0–100) from Sanity System
- Implemented as post-processing on the audio (filters, pitch shift) — not a separate audio file
- Intensity curve is tunable in config block

---

## Config Block
All tunable values in one place. Named by what they do.

```
AUDIO_CONFIG = {
  crossfadeDuration: {
    menuToIntro: ...,
    introToDesert: ...,
    desertToTemple: ...,
    templeToEnd: ...,
    settingsResume: ...
  },
  sceneVolume: {
    menu: ...,
    intro: ...,
    desert: ...,
    temple: ...,
    end: ...
  },
  actionVolume: {
    footstep: ...,
    nikoPickup: ...,
    nikoPutdown: ...,
    nikoHug: ...,
    uiButton: ...
  },
  sanityDistortion: {
    minIntensity: ...,   // at sanity 100
    maxIntensity: ...,   // at sanity 0
    filterType: ...,
    pitchShiftRange: ...
  }
}
```

---

## Asset Manifest
11 files total. All scene files must be **seamlessly loopable**.

| File | Layer | State |
|---|---|---|
| `menu-ambient.mp3` | Scene | MENU |
| `intro-audio.mp3` | Scene | INTRO |
| `desert-ambient.mp3` | Scene | DESERT |
| `temple-ambient.mp3` | Scene | TEMPLE |
| `end-audio.mp3` | Scene | END |
| `footstep-a.mp3` | Action | Any |
| `footstep-b.mp3` | Action | Any |
| `niko-pickup.mp3` | Action | Any |
| `niko-putdown.mp3` | Action | Any |
| `niko-hug.mp3` | Action | Any |
| `ui-button.mp3` | Action | Any |

---

## Dependencies

| Input | Source | Used For |
|---|---|---|
| `gameState` | Game State Machine | Drives audio state changes |
| `sceneTransitionEvent` | Scene Management | Triggers crossfades |
| `sanity` float | Sanity System | Drives distortion intensity in TEMPLE |
| `movementVelocity` | Player Controller | Triggers footstep events |
| `nikoState` | Player Controller | Triggers Niko action sounds |

---

## Failure Modes

| Risk | Mitigation |
|---|---|
| Browser autoplay policy | Click-to-start gate required before any audio fires |
| Assets not loaded before gameplay | Full preload must complete before INTRO state begins |
| Footsteps fire while stationary | Key off actual movement velocity, not key-held state |
| Scene layer goes silent between states | Transition layer must overlap — new audio starts before old fades out |
| Sanity distortion leaks into non-TEMPLE states | Guard all distortion logic behind `currentState === TEMPLE` check |
