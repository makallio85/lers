# Lers

An independent, community-oriented settlement and real-time strategy game inspired by The Settlers III. Public project; no monetization objective.

**Status:** project foundation, not a playable game yet. The simulation experiment is executable; rendering, economy, combat, networking and mobile apps are not implemented.

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

## Run the foundation

Requires Node.js 24; no third-party packages.

```sh
npm test
npm run benchmark
```

The benchmark measures only movement of 10,000 units on an empty map. It does not measure rendering, collision avoidance, pathfinding, combat, networking or device performance. It cannot establish that the finished game meets its scale targets.

## Project map

- [Game design](docs/game-design.md): familiar gameplay and menus, original presentation.
- [Technical research](docs/research/technical-architecture-2026-10-24.md): engine comparison, existing implementations, networking, mobile, navigation and small-community hosting.
- [Architecture](docs/architecture.md): shared simulation, authoritative server, browser and mobile clients.
- [AI integration](docs/mcp.md): agent commands, visibility rules and runtime responsibilities.
- [Roadmap](docs/roadmap.md): milestones and acceptance criteria.
- `packages/simulation/`: initial fixed-step movement experiment and tests.
- `scripts/benchmark.mjs`: reproducible CPU-only baseline.

## License

Original project code is provided under the MIT license; see [LICENSE](LICENSE). Commercial reuse is permitted, although this project's goal is not monetization. Third-party assets and dependencies must retain their own compatible licenses and attribution. No original Settlers content is included.
