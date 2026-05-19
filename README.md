# Horror Game — Claude Code Build Instructions

## Your Role
You are the executor. All architecture and design decisions are already made. Your job is to implement exactly what the specs say. Do not make design decisions. If something is ambiguous or missing, refer to unsure instructions before implementing.

## Tech Stack
- Three.js (rendering, scene, camera)
- Cannon.js (physics)
- Vite (dev server + build)
- Vanilla JS (no framework)

## Build Order
Implement systems in this exact order. Do not skip ahead. Each system depends on the ones before it.

1. `GameStateMachine.md`
2. `scene-management-spec.md`
3. `collision-system-spec.md`
4. `player-controller-spec.md`
5. `zone-system-spec.md` + `zone-editor.md` (these go together — implement runtime zone system first, then the editor tool)
6. `sanity-system-spec.md`
7. `audio-manager-architecture.md`
8. `lighting-system-spec.md`
9. `enemy-system-spec.md`
10. `postprocessing-spec.md`

## Rules
- Implement one system fully before starting the next
- All tunable constants go at the top of each file, named by intent — no magic numbers inline
- Each system should be a class in its own file under `/src/systems/`
- Entry point is `main.js` — it instantiates GameStateMachine and nothing else
- No system fetches its own assets — assets are passed in at initialization
- If a spec says something is a stub or hook for later, implement it as a stub — do not design the full thing
- Do not add features not in the spec

## When You're Unsure
Do not ask the human. Make the most conservative, spec-consistent decision possible and document what you decided in a comment. Keep moving.
