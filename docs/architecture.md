# Architecture direction

This document records intentions, not implemented services or a final engine selection.

## Shared rules, multiple hosts

Keep simulation independent of DOM, rendering, sockets and AI providers. A match host owns the authoritative world. Multiplayer and online solo use a server; offline solo can later run the same rules in a browser worker or mobile host. Offline solo must support pause/save/load. External MCP agents require a reachable match host.

Clients submit validated player commands; the match host applies them on fixed simulation ticks. The server filters observations by player visibility before sending them to clients or bots. Clients interpolate movement for presentation. Server and render update rates are separate and must be measured.

## Planned boundaries

- `packages/simulation`: world state, commands, fixed-step rules and versioned saves.
- Future protocol package: versioned commands, player observations and errors.
- Future match server: sessions, command validation, snapshots, reconnection and persistence.
- Future renderer/client: camera, terrain, unit rendering, selection and menus.
- Future mobile shells: packaged iOS and Android apps sharing the client where practical; choose wrapping framework or native renderer after a real-device spike.
- Future MCP adapter: authenticated player-scoped tools over the match command interface.

Do not choose mobile packaging based solely on desktop browser results. Measure GPU load, memory, thermals, touch interaction and suspend/resume on named physical devices before committing to a framework. Store signing secrets outside the repository.

## Scale strategy

Partition the map spatially; share long-distance route computations between armies; bound local avoidance work. Batch repeated geometry, cull off-camera rendering and provide visual detail levels. Send relevant state changes rather than the entire world every frame. Visibility filtering must not reveal hidden enemies through identifiers or errors.

Use command IDs and sequence checks so retries cannot duplicate orders. Reject malformed, stale and unauthorized commands. A long match needs periodic snapshots, schema versioning, reconnect recovery and an agreed policy for disconnects/pause/bot takeover. Preserve game state after server restart; prove this in an integration test.

## First experiment

The current JavaScript module is deliberately small: seeded unit positions, fixed-step movement orders, ownership checks and save/restore. It is not the selected final engine and contains no pathfinding, combat or network stack. Benchmark it as a baseline, then add realistic costs incrementally. Only choose a different language or WebAssembly after profiling a representative workload.

## Performance acceptance work

Record hardware, browser/OS, build, seed, map and unit counts, p50/p95/p99 tick time, client frame time, peak memory and network throughput. Include worst-case converging armies, narrow crossings, construction changes and civilian transport. Run a four-hour soak and mobile background/reconnect tests. Set device-specific budgets before calling any target achieved.
