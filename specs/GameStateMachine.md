# GameStateMachine — Architecture Spec

## Purpose
The single source of truth for the entire game's flow. Open this folder and you understand how the whole game works. Every state, every transition, every dependency lives here.

---

## Folder Structure

```
GameStateMachine/
  index.js               ← boots the game, owns current state, all transitions, renderer init
  
  /flow                  ← ordered by game timeline (read top to bottom = the game)
    StartState.js        ← press start screen, listens for input
    IntroState.js        ← cutscene, player frozen, systems spin up
    DesertState.js       ← player in control, desert environment
    TempleState.js       ← player enters temple
    ExitState.js         ← player escapes back outside
    EndState.js          ← death or escape screen, handles restart

  /utilities             ← not time-based, grouped by category
    SettingsState.js
    /settings
      VideoState.js
      AudioState.js
```

---

## index.js Responsibilities
- Initialize Three.js renderer (once, at boot)
- Hold current state reference
- Define all transitions between states
- Nothing else

---

## State File Structure
Every state file has three sections:

```
Enter
  - what loads
  - what systems start
  - what the player sees
  - starting transition / handshake in

Running
  - what's being checked
  - what inputs are being listened for
  - what's updating per frame

Exit
  - ending transition / handshake out
  - cleanup before next state takes over
```

---

## Transitions
- Owned by the state handing off, not a separate system
- Each state handles its own exit handshake
- Transitions are not instant — the exit section of each state manages the animation/crossfade
- The state machine itself changes state cleanly once the handshake completes

---

## Key Decisions
- No SceneManager — Three.js scene/camera/renderer are dependencies set up at boot in index.js
- Active gameplay is not one state — it's a cluster of flow states (Desert, Temple, Exit)
- Settings/utilities are organized by category, not timeline
- The folder is readable as a map of the game — top to bottom tells the full story

---

## What This Is NOT
- Not a place for system logic (audio, sanity, player controller, etc.)
- Not a place for rendering code beyond initial setup
- Not a place for asset loading logic — that belongs inside each state's Enter section
