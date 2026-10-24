# Roadmap

All milestones below are planned. Only the movement baseline currently exists.

1. **Performance and protocol spike.** Browser renderer plus authoritative host, fixed seed and recorded commands. Exercise 10,000 units across an open map, then obstacles and crossing armies. Publish CPU, GPU, memory and bandwidth results. Test at least one iOS and one Android device before choosing mobile packaging.
2. **Familiar settlement loop.** One original faction; physical goods transport, construction, timber and food chains. Save/load. Playtest familiar menu organization and controls with Settlers III players.
3. **Military vertical slice.** Mining, tools, weapons, recruitment, territory, visibility and individual combat. Validate large armies with civilians still active.
4. **Single-player and multiplayer.** Shared rules, built-in opponents, lobby/team configuration, authoritative command validation, reconnect, crash recovery, spectator visibility rules and versioned saves.
5. **MCP players.** Implement scoped observation/command tools and an example agent runner; human/built-in/external mixed matches; demonstrate no hidden-state access and defined timeout behavior.
6. **Mobile applications.** Ship actual iOS and Android builds with touch-native interactions, safe-area handling and suspend/reconnect. Validate cross-play and store packaging/licensing requirements; a responsive web page alone does not complete this milestone.
7. **Long matches.** Large maps, balance, victory conditions, three-to-four-hour playtests, four-hour performance soak and complete save/resume/reconnect verification.

The performance spike must grow into a representative test; an empty-map movement score is not a launch criterion. Keep new mechanics subordinate to the familiar economy and controls until the core loop is enjoyable.
