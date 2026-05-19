# Scene Management

## What it owns
- GLTFLoader for both desert and temple assets
- Three.js scene object
- Cannon.js physics world
- Hardcoded world-space placement of both assets
- Physics body creation from loaded geometry
- Accessors for other systems to reach in

## Loading sequence
Both assets load simultaneously during `START` state, before the player sees anything. Once both are loaded, placed, and physics bodies built — fires `onSceneReady`. Nothing else runs until that event lands.

## Accessors

| Method | Returns | Who uses it |
|---|---|---|
| `getScene()` | Three.js scene | Any system adding objects |
| `getPhysicsWorld()` | Cannon.js world | PlayerController, CollisionSystem, EnemySystem |

## Outputs
- `onSceneReady` → GameStateMachine (prerequisite for `START → INTRO`)

## What it does NOT own
- Cannon.js step call (GameStateMachine render loop owns that)
- Visibility toggling (nothing gets hidden — both assets live in world space permanently)
- Zone logic (ZoneSystem owns what changes when player crosses into temple)
- Lighting/post-processing switches (those systems own their own zone responses)

## Dependencies
- Cannon.js
- Three.js GLTFLoader
- GameStateMachine listens for `onSceneReady`

## Failure modes

| Risk | Mitigation |
|---|---|
| Asset load fails silently | Error handler on GLTFLoader — log clearly, block transition |
| Physics body creation from large mesh is slow | Happens fully in `START` behind overlay — player never sees it |
| Systems call accessors before ready | Guard accessors — throw or warn if called before `onSceneReady` |
