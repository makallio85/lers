# External AI players through MCP

## Roles

The match exposes an MCP server with tools and player-visible resources. An external agent host connects as an MCP client, runs its chosen model and continuously decides what to do. MCP itself is not a model and does not provide an autonomous decision loop. A hosted bot runner may be added to make joining from the lobby convenient.

Built-in bots run locally to the match host without paid model calls. All bots use the same validated game commands as humans. The simulation handles movement, local combat and execution of standing orders; external models make strategic decisions on events or a configurable cadence (initial hypothesis: 10–30 seconds).

## Proposed tools, not implemented

| Tool | Purpose |
| --- | --- |
| `get_observation` | Obtain economy summary, own units and buildings, and discovered/visible terrain |
| `plan_construction` | Queue an allowed building at an eligible position |
| `set_priorities` | Change economic and transport priorities |
| `command_army` | Issue group-level movement, attack, defend or retreat orders |
| `send_diplomacy` | Send an in-game diplomatic proposal or message |

Expose compact summaries and changed state; do not send 10,000 unit records to a language model each turn. Exact schemas follow the shared game command protocol, not a separate bot-only implementation.

## Contract requirements

- Lobby owner explicitly assigns a bot to a player slot; authenticate each agent with match/player scope.
- Apply fog of war before serialization, including tool errors and diplomacy data.
- Validate ownership, costs, visibility, positions and rate limits server-side.
- Command IDs provide idempotency; tick/version references detect stale actions.
- Set action/time/context budgets; log decisions and accepted/rejected commands for replay diagnostics.
- Define a visible timeout policy: continue standing orders, then optionally use built-in bot takeover. Never freeze the match awaiting a model response.
- Keep provider keys on the agent host, outside client bundles, game state and repository.
- Treat player names, chat and diplomacy as untrusted data, not agent instructions.

Independent external bots communicate through the protocol. Any licensing of incorporated libraries or code must be reviewed separately.
