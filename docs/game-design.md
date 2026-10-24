# Game design baseline

## Language

The entire game is in English: menus, tooltips, tutorials, notifications, error messages and default bot communications. Repository code, documentation and issue tracking are also in English. User-authored chat remains user content.

## Familiarity is a requirement

The owner explicitly wants gameplay logic, available actions and menus to follow The Settlers III closely enough to lower the learning barrier and attract existing players quickly. This is a design reference, not permission to copy protected material. Implement systems independently; create original visuals, wording, interface artwork, maps, music and worldbuilding.

Before changing a familiar interaction, record which player problem the change solves. Avoid inventing complexity merely to differentiate the game.

## Initial interaction map

These are proposed Lers categories, not a verified transcription of original menus. Validate against lawful gameplay observation before detailed UI work.

| Area | Intended familiar actions |
| --- | --- |
| Construction | Select a building category, inspect costs and placement suitability, place or cancel construction |
| Economy | Inspect stock, workers, production chains, tool needs and transport priorities |
| Territory | Expand controlled land using military buildings; reveal nearby terrain through exploration |
| Military | Recruit and equip units, select groups, move, attack, defend and retreat |
| Match | Minimap, objectives, diplomacy, settings, save/load where allowed and pause where allowed |

Keep common actions easy to find, tooltips concise and feedback immediate. Show why production is blocked. Do not bury routine construction behind modern multi-step dialogs.

## First playable economy

Start with one original faction and a focused chain: forestry → timber processing → construction; grain → flour → bread; food → mining → metal → tools/weapons. Decide exact recipes, worker rules and transport behavior in implementation issues. Do not claim complete Settlers III parity.

Map scale and transport constraints should create decisions about settlement placement and supply lines. Three to four hour matches must have meaningful early, middle and late phases rather than simply long walking times. Test timings with players.

## Military scale

Individual soldiers remain visible and meaningful. Army-level movement shares route calculations where appropriate, with local avoidance. Do not silently replace individual combat with decorative crowds. Validate proposed simplifications through performance measurements and playtests.

## Browser and mobile

Use the same rules and match format across browser, iOS and Android. Desktop: pointer selection, drag selection and contextual orders. Mobile: tap selection, clear explicit order modes, touch-sized controls, pinch zoom and group selection tools. Never require hover or right click to access an essential action. Mobile backgrounding must allow safe reconnection; the OS may suspend the app.

## Familiarity playtest gate

Give a returning Settlers III player a fresh map without a long tutorial. They should find building categories, establish timber and food production, inspect a bottleneck, expand territory and issue a military order. Record completion time and confusion points; set quantitative thresholds after the first pilot. Test new players separately.

## First playable match: 20–30 minutes

Deliver a small complete match before tuning the 3–4 hour format. The player must establish working timber and food production, expand territory, recruit a force, fight a meaningful battle and reach a clear victory or defeat. Use accelerated/scenario-specific pacing without locking the final game to short matches. Run the independent 10,000-unit technical workload in parallel with this product milestone.

The slice must surface stock, missing inputs and transport priorities clearly. Test it with returning Settlers III players and new players. Record whether unfamiliar controls, idle waiting or an unclear objective prevent completion.

## Match pacing and victory

Long matches need meaningful early, middle and late decisions. Travel distance alone must not determine duration. Prototype territorial victory and an optional objective-based victory mode; select and tune exact conditions through playtesting. Include individual surrender and team surrender with an explicit voting policy. Record when a match becomes effectively decided versus when it ends, and reduce drawn-out cleanup.

A lost battle should leave reasonable recovery choices: rebuild, defend a chokepoint, cooperate with an ally or attack a strategically valuable production route. Define elimination and allied assistance rules explicitly; do not promise unlimited recovery after total defeat. Prototype terrain, chokepoints and economic disruption before adding more unit types.

## Long-session continuity

Support saving a multiplayer match and resuming it later with the same participants. Specify who may pause, save, resume or approve a replacement player; persist player-slot identity independently of a transient connection. Define disconnect grace periods and configurable built-in bot takeover, showing the policy in the lobby. A slow or unavailable external AI must never stall the simulation.

## Maps and fairness

Generate reproducible maps from a seed and generator version. Validate starting resource access, expansion opportunities and connectivity for every player. Allow asymmetric layouts only when intentionally selected and communicated. Explore a map editor and community maps after core play is stable.

## Cross-device army controls

Prototype selecting, grouping and commanding large armies on a physical phone early. Saved army groups, explicit order modes and clear selection feedback must cover essential desktop interactions without requiring pixel-precise taps. Keep rules equal across devices; test usability and performance separately.

## Fair AI participation

Default bots receive the same visibility and resource constraints as humans. Publish command-rate and decision-budget rules; explicitly label any difficulty mode that grants extra information or resources. Built-in opponents must work without paid external model calls. External MCP agents are optional and their runner must expose usage budgets and timeout policy.

## Sharing, spectators and community

Plan private matches joined through invite links, spectator mode and later user-authored maps/rules. Spectator information must follow an explicit team/delay policy and must not leak hidden state to active players. Keep invitations separate from public matchmaking and authenticate player-slot claims.

Record versioned seeds and accepted commands alongside snapshots for diagnostics. Replays need the matching simulation version or an explicit compatibility/migration policy. Plan replay playback and shareable match summaries after the core loop; never expose authentication tokens or provider keys in exports.
