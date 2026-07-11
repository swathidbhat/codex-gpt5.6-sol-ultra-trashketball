# Trashketball — Quota Mode

A two-level, physics-based 3D paper-toss game built with React and Three.js.

## Levels

1. **Severed Floor** — sink ten crumpled paper balls in a wire office basket. Each basket is worth 10 points; 100 points unlocks the transfer.
2. **Coastal House** — continue throwing in a double-height luxury beach house with a floor-to-ceiling ocean view and a sculptural brass-trimmed bin.

The game includes a live ballistic trajectory, fixed-step paper-ball physics, swept rim scoring, mouse/touch controls, keyboard controls, procedural environments, synthetic sound, responsive HUD, and an automatic level transition.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal. Drag or use the arrow keys to aim, hold and release the pointer (or Space) to throw.

## Validate

```bash
npm run build
npm test
```
