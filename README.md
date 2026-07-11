# Trashketball — Quota Mode

A two-level, physics-based Three.js paper-toss game.

**Play publicly:** https://swathidbhat.github.io/codex-gpt5.6-sol-ultra-trashketball/

## Levels

1. **Severed Floor** — sink ten crumpled paper balls in a wire office basket. Each basket is worth 10 points; 100 points unlocks the transfer.
2. **Coastal House** — continue throwing in a double-height luxury beach house with floor-to-ceiling ocean views and a sculptural brass-trimmed bin.

The game includes a live ballistic trajectory, fixed-step paper-ball physics, swept rim scoring, mouse/touch controls, keyboard controls, procedural environments, synthetic sound, and an automatic level transition.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Drag or use the arrow keys to aim, then hold and release the pointer—or Space—to throw.

## Validate

```bash
npm run typecheck
npm test
```

Every push to `main` publishes the static `dist/` build through the GitHub Pages workflow.
