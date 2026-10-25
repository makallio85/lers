# Lers

An independent, community-oriented settlement and real-time strategy game inspired by The Settlers III. Public project; no monetization objective.

**Status:** first playable match. You play against a built-in computer player on a mirrored map: build an economy (timber, food, mining, metal), recruit soldiers, expand with towers and take the enemy castle. A sandbox without an opponent is in the menu. Saving and loading work in the browser. Artwork, sound, multiplayer, AI agents and mobile apps are not implemented yet.

## Experience

The Settlers III is the reference for gameplay flow and information architecture. A returning player should understand the economy, construction, territorial expansion, army controls and menu categories without a long tutorial. Familiar interactions matter more than adding novelty. Implement independently with original code, world, artwork, icons, text, maps and audio; do not reproduce the original game's assets or screens pixel for pixel. Lers is not an official remake or affiliated product.

- Goods physically travel between workers, buildings and warehouses.
- Food, mining, tools and weapons connect the civilian economy to military power.
- Large maps support several settlements, supply routes and simultaneous fronts.
- Target 3–4 hour matches, with save/resume and reconnection.
- Single-player and multiplayer; humans, built-in bots and external AI agents can share a match.
- Browser, iOS and Android clients are first-class targets, with touch controls and cross-play planned.

English is the project language: all player-facing UI, menus, tutorials, notifications, default bot messages, code, documentation and issues use English. Other languages are outside the initial scope.

Initial scale targets are 2–8 players and 5,000–10,000 soldiers plus civilians **per match**, not per player. These are hypotheses to validate, not measured capabilities.

## Play and develop

Requires Node.js 24.

```sh
npm ci
npm run dev           # play locally at the printed address
npm run build:single  # dist/single/index.html: the whole game in one file
npm test              # simulation tests
npm run typecheck
npm run benchmark     # movement-only baseline
```

Add `?seed=<number>` to the address to replay the same map.

Controls:
- Map: arrow keys, right- or middle-drag to scroll (one finger on touch screens); mouse wheel or pinch to zoom; click the minimap to jump.
- Build: Q/W/E/R open the build groups (Resources, Food, Military, Misc.), A/S/D/F the goods views, as in The Settlers III. Choose a building, then click a green marker (touch: tap to position, then press Place). Esc or right-click cancels.
- Soldiers: left-drag a box (touch: Select, then drag), click one soldier, or use All in view. Right-click moves them, or attacks when you right-click an enemy tower or castle; the Move and Attack buttons do the same by touch. Ctrl+1–9 saves a group, 1–9 selects it.
- Space pauses; 1×, 2× and 4× set the speed (1× is the pace of The Settlers III). Menu saves, loads, starts a new match (map size: small, medium or large; opponent: calm or aggressive) or a sandbox, and surrenders.

Add `?seed=<number>` to the address to replay the same map, `&mode=sandbox` for a game without an opponent, and `&size=small` / `&bot=calm` (or `#small-calm` where only the hash reaches the page) to pick the map size and opponent.

The benchmark measures only movement of 10,000 units on an empty map. It does not measure rendering, collision avoidance, pathfinding, combat, networking or device performance. It cannot establish that the finished game meets its scale targets.

## Project map

- [Game design](docs/game-design.md): familiar gameplay and menus, original presentation.
- [Technical research](docs/research/technical-architecture-2026-10-24.md): engine comparison, existing implementations, networking, mobile, navigation and small-community hosting.
- [Architecture](docs/architecture.md): shared simulation, authoritative server, browser and mobile clients.
- [AI integration](docs/mcp.md): agent commands, visibility rules and runtime responsibilities.
- [Roadmap](docs/roadmap.md): milestones and acceptance criteria.
- `packages/simulation/`: game rules (map generation, buildings, settlers, transport) with tests; `world.mjs` is the earlier movement experiment.
- `packages/client/`: browser client (PixiJS map, HTML menus).
- `scripts/benchmark.mjs`: reproducible CPU-only baseline.

## License

Original project code is provided under the MIT license; see [LICENSE](LICENSE). Commercial reuse is permitted, although this project's goal is not monetization. Third-party assets and dependencies must retain their own compatible licenses and attribution. No original Settlers content is included.

## Deployment

`docker-compose.yml` builds the game (`npm run build`) and serves it as static files with nginx, with `/health` for health checks. Coolify deploys `main` to https://lers-dev.dev.rocksoftware.fi and gives each pull request against `main` its own preview address. Saves live in each player's browser, so there is no database yet.

