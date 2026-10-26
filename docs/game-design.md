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

## Settlers, specialists and the wider economy

These follow The Settlers III as described in its manual (issue #12, phase 1).

- **Occupations:** the player sets a minimum share of carriers and a maximum share of diggers and builders together. Within those shares, a free carrier becomes a digger or builder when a site waits for one. It takes a shovel or hammer from storage. Above the maximum, idle diggers and builders go back to carrying and return their tools. The defaults are at least 30 % carriers and at most 25 % crew.
- **Specialists:** a free carrier becomes a geologist (with a hammer) or a pioneer (with a shovel), and turns back again on request, returning the tool. The player sends specialists to a spot on explored land. They work around it, then wait there.
  - **Geologists** put up signs on mountain tiles within 6 tiles of the spot. Ore is hidden until a player's own geologist has marked it. Built-in bots see only ore their geologists have marked, and they keep two geologists at work.
  - **Pioneers** put up posts within 4 tiles of the spot. A post claims land that no enemy military building holds, including other players' pioneer land. Military land always wins over pioneer land.
- **Gold:** the gold mine (fish is the miners' favourite food) and the gold smelter (gold ore + coal → gold bar) are in. Each start's ore mountain has a little gold at its far edge. Elsewhere gold sits where ore is richest.
- **Lookout tower:** sees 22 tiles around it and claims no land.
- **Work areas:** woodcutters, stonecutters, foresters, fishers and farms work around a point the player sets, up to 14 tiles from the building and on their own land.
- **Construction sites:** "Build first" puts a site ahead of all others for materials and crew. Pausing a site suspends it: it gets no materials and no crew until it is resumed.

## Military depth

These follow The Settlers III as described in its manual (issue #12, phase 2).

- **Strength outside your own land:** on its own land a soldier always hits at full strength. Outside it, strength is 60 % with no gold. It rises with the gold bars in the player's storage, reaching full strength at 20 bars.
- **Healer:** a healer's hut with its healer inside heals the owner's soldiers within 8 tiles who are not fighting, 4 health every second. Tab selects the wounded soldiers outside.
- **Orders:**
  - **Waypoints:** Shift + right-click, or the Waypoint button, adds a stop after the current move. Up to 8 stops are queued.
  - **Patrol:** Alt + right-click walks back and forth between where the soldiers stood and the chosen spot.
  - **Hold position:** H. Soldiers stay put and fight only what comes into reach.
  - **Move, no fighting:** soldiers walk on without stopping until they arrive.
  - **Groups:** Alt + 1–9 saves a group (Ctrl + 1–9 as well), and 1–9 selects it.
- **Capture rule:** a tower or castle cannot be taken while another occupied military building of its owner covers it with its land. It can still be attacked, and its defenders fight. Once it stands empty, its attackers move on to the building that covers it.
- **Castle warning:** the owner gets a warning, at most once a minute, when enemy soldiers reach the castle.
- **Thief:** a free carrier becomes a thief without a tool. Sent near an enemy store, it takes one good and carries it home at half speed. It prefers gold, then weapons, iron and tools. To the enemy it looks like a carrier until an enemy soldier comes within 3 tiles. Soldiers then attack it like a soldier, and it survives about two hits.
- **Ranks and promotion** cost manna in the original, so they come with temples in phase 4.

## Peoples

The four peoples of the original game (issue #12, phase 3; the owner chose to follow the original four). Rules and numbers come from the manual. Names of buildings are ordinary words, and all art, sounds and texts are our own.

- **Costs:** every shared building costs planks and stone per people, from the manual's table. The overall plank-to-stone shares are Romans 44:56, Egyptians 31:69, Asians 75:25 and Amazons 59:41. Starting planks and stone follow those shares, 80 in total: Romans 40/40, Egyptians 25/55, Asians 60/20, Amazons 47/33.
- **Buildings only some peoples have:**

| People | Buildings |
|---|---|
| Romans | Winery (makes wine), charcoal maker (5 planks → 1 coal, as the manual says) |
| Egyptians | Brewery (grain + water → beer), gem mine (fish preferred) |
| Asians | Rice farm (beside water; the original needs swamp, which our maps do not have yet), distillery (rice + water → rice wine), sulfur mine (rice preferred), gunpowder maker (coal + sulfur → gunpowder) |
| Amazons | Beekeeper (makes honey), mead maker (honey + water → mead), alchemist (sulfur + gems → gold), gem mine, sulfur mine (honey preferred) |

- **Sulfur miners** eat rice, honey or bread, never meat or fish.
- **Egyptians' strength:** gold counts half and gems double toward strength outside their own land.
- **Choosing a people:** the player picks one when starting a match. The computer plays another one, chosen from the map seed.
- **What the drinks are for:** wine, beer, rice wine and mead feed the temples in phase 4. Gunpowder is the cannon's ammunition.
- **Balance:** this is not tuned yet. In 8 bot-vs-bot matches per pair on small maps, Romans beat Egyptians 5:3 and Asians 6:2, and lost to Amazons 1:7. Playtests should guide the tuning.

### War machines

Each people has a war machine hall (Military group) where a machinist with a hammer builds its machine from parts. A hall keeps at most three of its machines in the field. As in the original, machines are selected and ordered like soldiers: move, waypoints, patrol, and "fire at" a tower or castle. They need open ground (no forest, rocks or mountains), move at 60 % of walking speed and never fight people. Soldiers can break them. Out of ammunition, a machine goes back to its hall, reloads from the ammunition delivered there, and returns to its target.

| Machine (people) | Parts | Ammunition | Shots | Range | Damage | Hits | Hall cost |
|---|---|---|---|---|---|---|---|
| Catapult (Romans) | 2 iron, 3 planks, 2 stone | stone | 6 | 7 | 40 | 55 % | 5 planks, 7 stone |
| Ballista (Egyptians) | 2 iron, 3 planks, 2 stone | plank | 6 | 9 | 40 | 70 % | 3 planks, 9 stone |
| Cannon (Asians) | 3 iron, 2 coal | gunpowder | 4 | 8 | 65 | 80 % | 9 planks, 3 stone |
| War gong (Amazons) | 2 iron, 2 planks, 1 gold | gold | 2 | 5 | 130 | 90 % | 8 planks, 10 stone |

Hall costs are the manual's. The roles follow the original's setup text: the catapult misses most, the cannon is the strongest per shot, and the gong brings a tower down with one blow. The other numbers are our own. A building's structure is 120 for a small tower, 80 for a lookout, 240 for a large tower and 480 for the castle. When it reaches zero the building falls, its soldiers step outside, and the owner's buildings on land another player now holds are destroyed, as when a tower is captured. Destroying the castle wins the match. The computer builds its hall from minute 40, once it has a barracks, a smelter and a hammer (it orders one when needed, and a geologist hands his back if the toolsmith or the hall lacks one). It sends idle machines at the most strongly held tower they can reach. In 13 bot-vs-bot matches (small and medium maps) every match ended, in 33–112 minutes, with up to 23 machines built and 12 towers shot down in one match. Short aggressive matches often end before any machine is ready.

## Pace

At 1× the game runs at the pace of The Settlers III at normal speed, which has no speed setting of its own. These values were timed by watching the original run (screenshots and a stopwatch, nothing decompiled), on 2026-10-25:

| Action | The Settlers III | Lers |
|---|---|---|
| Walking | about 2.2 tiles a second | 2.2 tiles a second |
| Woodcutter at the tree (felling and cutting) | about 22 s | 22 s |
| Sawmill, one plank | about 15 s | 15.5 s |
| Small hut: levelling, then building | about 60 s + 40 s | 60 s + 40 s with one digger and one builder |
| Tree, sapling to full size | about 4.5 min | 4.5 min |
| Forester planting one sapling | about 4 s | 4 s |

Workshops and mines were not timed. Their times are three times the earlier values, the same factor the sawmill needed. The 2× and 4× speeds stay for test games.

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

The built-in bot has two types, and neither gets extra information or resources:

- **Calm** follows how the Settlers III computer players were observed to play: expand within the first minutes, build the economy with 2–4 sites open, drive intruders off at once, and attack no earlier than 20, 45 or 60 minutes on a small, medium or large map. It attacks the nearest weakly held tower with a squad sized to its garrison, keeps the rest of the army at home, and goes for the castle only later (35, 75 or 95 minutes) with 20 soldiers or more. At the original pace, 18 of 20 bot-vs-bot matches on a small map ended, after 40–150 minutes (median about 80).
- **Aggressive** attacks as soon as it has 6 soldiers and something to attack, with its whole army. On a small map 17 of 20 bot-vs-bot matches ended, after 32–88 minutes (median about 60), so a small-map test game at 4× takes about 15 minutes. On a medium map 7 of 10 ended, after 36–112 minutes.

Match maps come in three sizes: small (96 × 64 tiles) for test games, medium (144 × 96) and large (192 × 128). Every start gets trees, rocks, water and an ore mountain that reaches into the starting land, on the player's own half of the mirrored map.

Across these 50 matches the left and right players won equally often (20 and 21): a bot on the right half scans the map mirrored, so ties between equally good spots go the same way for both. Both types start only buildings whose planks and stone they already have, and save their stone for a stonecutter or a tower toward rocks when stone runs short. `stepMatch` can collect a log of each bot decision, with the tick and the reason, for tests and tuning.

## Sharing, spectators and community

Plan private matches joined through invite links, spectator mode and later user-authored maps/rules. Spectator information must follow an explicit team/delay policy and must not leak hidden state to active players. Keep invitations separate from public matchmaking and authenticate player-slot claims.

Record versioned seeds and accepted commands alongside snapshots for diagnostics. Replays need the matching simulation version or an explicit compatibility/migration policy. Plan replay playback and shareable match summaries after the core loop; never expose authentication tokens or provider keys in exports.
