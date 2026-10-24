# Roadmap

All milestones below are planned. Only the movement baseline currently exists.

1. **Performance and protocol spike.** Browser renderer plus authoritative host, fixed seed and recorded commands. Exercise 10,000 units across an open map, then obstacles and crossing armies. Publish CPU, GPU, memory and bandwidth results. Test at least one iOS and one Android device before choosing mobile packaging.
2. **Familiar settlement loop.** One original faction; physical goods transport, construction, timber and food chains. Save/load. Playtest familiar menu organization and controls with Settlers III players.
3. **Military vertical slice.** Mining, tools, weapons, recruitment, territory, visibility and individual combat. Validate large armies with civilians still active.
4. **Single-player and multiplayer.** Shared rules, built-in opponents, lobby/team configuration, authoritative command validation, reconnect, crash recovery, spectator visibility rules and versioned saves.
5. **MCP players.** Implement scoped observation/command tools and an example agent runner; human/built-in/external mixed matches; demonstrate no hidden-state access and defined timeout behavior.
6. **Mobile applications.** Ship actual iOS and Android builds with touch-native interactions, safe-area handling and suspend/reconnect. Validate cross-play and store packaging/licensing requirements; a responsive web page alone does not complete this milestone.
7. **Long matches.** Large maps, balance, victory conditions, three-to-four-hour playtests, four-hour performance soak and complete save/resume/reconnect verification. Define surrender/team surrender, recovery after a lost battle, fair seeded maps and multiplayer continuation across sessions.

## First playable gate

After milestones 2–3, deliver a complete 20–30 minute scenario covering a working economy, territorial expansion, recruitment, one meaningful battle and a clear outcome. Playtest familiarity and bottleneck feedback before expanding match duration. Keep the mass-unit technical benchmark independent of this gate.

The performance spike must grow into a representative test; an empty-map movement score is not a launch criterion. Keep new mechanics subordinate to the familiar economy and controls until the core loop is enjoyable.

## Community and diagnostics follow-up

Private invite-link lobbies, visibility-safe spectators, versioned command recording/replays and later community maps/rules support player acquisition and debugging. Build these incrementally after the first playable gate. Test large-army touch commands and publish bot fairness/budget rules before claiming cross-device and external-AI readiness.
