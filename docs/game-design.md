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

## Temples, priests and magic

Issue #12, phase 4. The roles follow the manual; the names, numbers and effects are our own.

- **Temples** (Misc. group, the manual's costs). Romans and Amazons build a small and a large temple, the Egyptians a sphinx and a pyramid, the Asians a small and a large pagoda.
  - A temple servant at the small temple offers the people's drink (wine, beer, rice wine or mead). Every 20 seconds one offering becomes one manna.
  - The large temple ordains a free carrier as a priest every 5 minutes, keeping the player's carrier share.
- **Priests** are selected and moved like geologists. A priest casts on a spot within 6 tiles; Far sight and Blight work at any distance. Each spell costs manna, and the priest rests 10 seconds after casting.
- **Spells:** each people knows 8 of these 11.

| Spell | Effect | Manna |
|---|---|---|
| Far sight | Shows 15 tiles around the spot for a minute | 5 |
| Grow forest | Grown trees on free grass within 3 tiles | 6 |
| Raise stones | Rocks on free grass within 2 tiles | 6 |
| Harvest | Fields within 8 tiles ripen and young trees grow up | 8 |
| Transmute | In the nearest own storage: Romans 10 fish → meat, Egyptians 6 stone → iron, Asians 4 iron → gold, Amazons 3 stone → gold | 10 |
| Gift | In the nearest own storage: Romans 12 planks, Egyptians 4 gems, Asians 10 rice, Amazons 10 honey | 8 |
| Shield | Own soldiers within 6 tiles take half damage for a minute | 12 |
| Fury | Own soldiers within 6 tiles hit twice as hard for a minute | 15 |
| Freeze | Enemy soldiers within 5 tiles cannot act for 15 seconds | 12 |
| Persuade | Up to 3 enemy soldiers within 4 tiles change sides | 25 |
| Blight | Enemy mines within 6 tiles work at half speed for 5 minutes | 15 |

| People | Spells |
|---|---|
| Romans | Far sight, grow forest, harvest, transmute, gift, shield, fury, persuade |
| Egyptians | Far sight, raise stones, harvest, transmute, gift, shield, freeze, persuade |
| Asians | Far sight, grow forest, harvest, transmute, gift, fury, freeze, blight |
| Amazons | Far sight, grow forest, raise stones, transmute, gift, shield, freeze, blight |

- **Ranks:** private, sergeant and captain, set per soldier type.
  - Promotion costs 10 manna to sergeant and 20 to captain.
  - As in the manual, it applies to soldiers recruited afterwards; those already serving keep their rank.
  - Each rank adds 25 % health and damage.
- **Computer player:** after the barracks it builds its people's drink maker and a small temple, and later a large temple. It promotes whenever it has the manna. In two 60–81 minute bot matches on medium maps, every people reached sergeant or captain. Its priests follow the army. In a fight near a priest, manna goes to spells first: Persuade on three or more enemies, Freeze on two, Fury or Shield on its own soldiers. Once every soldier type is a captain, spare manna goes to Blight on enemy mines in sight, Harvest at home, or Far sight toward the enemy. In three long bot matches priests cast only now and then, because they seldom reach a fight in time.

## Trade

Issue #12, phase 5, following the manual.

- **Carriers stay on their own land.** Civilians walk only on their own territory, and goods only move between buildings on the same connected stretch of it. Soldiers, specialists, priests, thieves and donkeys may leave it. A colony cut off by neutral or enemy land is supplied by caravans.
- **Donkey ranch:** a breeder raises a donkey from one grain and one water every minute, while the ranch has fewer than four waiting.
- **Marketplace:** one land route per marketplace. The route's end can be anywhere on the map, with up to three waypoints on explored land before it.
  - For each good the player sets an amount to send, in steps of a donkey's load (8), or "All".
  - Carriers bring the goods to the marketplace in one of the original's three modes: only surplus (each storage keeps 8 of each good), ahead of construction sites, or suspended.
  - Up to four donkeys work for a marketplace. Each carries 8 of one good along the route, across any land, unloads at the player's storage within 12 tiles of the route's end, and comes back. Without a storage there, it brings the load back and warns.
- **Computer player:** it does not trade yet. Its settlements grow in one piece.

## Sea

Issue #12, phase 6, following the manual.

- **Map layout:** a match is set up on a continent or on islands. On islands each player starts on an island of their own, with a neutral island between them; nobody can walk to anyone else.
- **Shipyard:** stands on a shore of the open sea (a lake does not count). A shipbuilder with a hammer builds the ships ordered there, three minutes each. Costs per people, in planks and iron:

  | Ship | Romans | Egyptians | Asians | Amazons |
  |---|---|---|---|---|
  | Transport ship | 4 + 1 | 7 | 5 | 4 + 1 |
  | Trade ship | 6 + 1 | 8 + 2 | 4 | 6 + 1 |

- **Transport ship:** carries soldiers, specialists and priests (Romans 7, Egyptians 9, Asians 6, Amazons 8). They board within 3 tiles of the ship and go ashore on the land next to it. Ships sail 30 % faster than settlers walk and cannot attack.
- **Landing dock:** the sea version of the marketplace, also on the open sea. Carriers bring the goods of its sea route; up to three trade ships take a load each (Romans 3 piles of 8, Egyptians 4, Asians 2, Amazons 3), sail to the water nearest the route's end, unload at the player's storage there, and come back.
- **Second colony:** pioneers sail out on a transport ship and claim land on another island. *Become carriers* turns chosen geologists, pioneers or thieves into carriers where they stand; their tools go to the nearest storage on their land, else the castle.
  - A building on land cut off from the castle must connect to one of the player's buildings there, or, before the first one, to where the player's settlers stand.
  - A site there gets its digger and builder from the carriers on that land, whatever the crew share at home.
  - Trade ships and caravans unload at the player's storage near the route's end, or, without one, into the construction site there that still needs the good. That is how a colony's first storage area gets its planks and stone; what the site does not need goes back.
- **Computer player:** on islands it builds a shipyard once it has barracks, orders a transport ship, and ferries an attack's worth of soldiers toward the enemy side, scouting by sea until it sees a shore there. Landed soldiers attack from where they stand; soldiers at home defend and wait for the ship. It does not build trade ships or colonies yet.

## Showing the settlement

The map shows what the simulation holds, so a player can read the settlement without opening cards.

- **Settlers stay in the world** unless they occupy a building: its worker, its garrison, or soldiers going in. Idle carriers, builders and diggers wait outside, within nine tiles of the middle of the nearest storage area on their land; recruits step out of the barracks and new settlers out of their residence.
- **The start:** the settlers and the soldiers not garrisoned come out of the castle one by one, half a second apart, and walk to spots spread evenly over its land (a sunflower spiral from its walls to nine tiles out), soldiers and civilians mixed.
- **Standing settlers keep a tile each.** One standing still on a tile another one holds, in a doorway, or where a building has since been put up steps to the nearest free tile, so groups stand next to each other. Soldiers, war machines, specialists and priests keep their place before idle civilians, then the lower id, the same for every player.
- **Construction crews:** as observed in The Settlers III, several diggers level one site and several builders put it up: up to size + 1 diggers and as many builders as its size (3 and 2 for a small hut). Each works from its own spot along the site's edge. The work is measured for two: two diggers level a small hut in about 60 s and two builders build it in about 40 s; one alone takes twice as long, a full crew less. Each builder works one delivered good at a time.
- **Entrances connect over own land.** A new building may not cut any of the player's buildings off from the castle over the player's own land, which is where carriers walk. Before, it only had to leave them reachable over any land, so a building could split home territory and strand a mine. A new worker fetches its tool from a storage area on the workplace's own stretch of land.
- **Walkers are drawn apart.** Settlers closer than their size are drawn pushed apart, never into a building; war machines and ships take more room. Only the drawing moves, not the simulation.
- **Goods lie where they are.** A building's goods are piled in its yard, one item per good up to piles of eight: what it waits to work on at the front left, what it made at the front right. Storage areas show their piles across the yard, and construction sites show their delivered materials. The castle keeps its goods inside.
- **Carried goods** are drawn large enough to tell what each carrier and donkey carries.
- **Work shows:** woodcutters, builders, stonecutters and geologists swing their tool; diggers, pioneers and farmers bend down to dig, sow and plant. Tools are drawn half again as large as life so they read at normal zoom.
- **Mills turn their sails** while the miller grinds.
- **Smoke** rises from workshops with a fire while their worker is at work.
- **Fallen soldiers** fall where they stood, lie a moment and fade.
- **Demolished buildings collapse:** a building that is demolished, burnt down or brought down sinks into the ground in a cloud of dust. One that only goes out of sight just disappears.
- **Carriers bend** to pick up and put down their loads.
- **Sound:** chops, hammer blows, picks on stone, spades in earth, swords and bows, falls, collapsing buildings and war machine shots play for what is on screen, quieter toward its edges and panned to their side. The interface clicks, warns, and chimes when a building is finished or the match ends. Sound starts after the first tap or click, as browsers require, and can be turned off in the menu. The sounds are Kenney's CC0 packs, converted by `art/sounds.sh`.
- **Garrisons stand on the walls:** the soldiers inside a tower or castle, by type, up to two on a small tower, four on a large one and six on the castle.

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

### Economic mode

Issue #12, phase 7, following the manual: the match is won by reaching goods targets, and soldiers are very weak outside their own land.

- **Targets:** goods the player's workshops and mines make over the match. The first player to make all of them wins; castles still stand.

  | Map | Planks | Bread | Meat | Iron bars | Gold bars |
  |---|---|---|---|---|---|
  | Small | 160 | 40 | 30 | 30 | 15 |
  | Medium | 240 | 65 | 50 | 45 | 25 |
  | Large | 320 | 90 | 70 | 60 | 35 |

- **Soldiers outside their land** hit at a quarter of their strength, whatever gold their owner holds. At home they are as strong as ever, so defending still matters.
- **The Stats tab** shows the race: each target with your progress and the computer's.
- **Computer player:** it does not attack, only defends. In bot-vs-bot runs, races on small and medium maps ended at about 85 minutes, with bread the slowest target before it was lowered.

## Long-session continuity

Support saving a multiplayer match and resuming it later with the same participants. Specify who may pause, save, resume or approve a replacement player; persist player-slot identity independently of a transient connection. Define disconnect grace periods and configurable built-in bot takeover, showing the policy in the lobby. A slow or unavailable external AI must never stall the simulation.

## Maps and fairness

Generate reproducible maps from a seed and generator version. Validate starting resource access, expansion opportunities and connectivity for every player. Allow asymmetric layouts only when intentionally selected and communicated. Explore a map editor and community maps after core play is stable.

### Match setup

Issue #12, phase 7, following the original's game setup.

- **Map halves:** mirrored (the default: the right half copies the left, so both players start on the same land) or each its own. Unmirrored, each half is generated on its own, and each start still gets the same prepared surroundings: a grove, a rock cluster and a pond inside the territory, and an ore mountain on its border. Over 40 seeds of each map size, every unmirrored continent let the players walk to each other.
- **Starting goods:** few, normal or many. Few halves the materials, food, tools and soldiers and gives three quarters of the civilians. Many doubles the materials, food, tools and soldiers and gives half as many civilians again. Every kind keeps at least one, so a short start still has each tool.
- **Computer player:** with too few hammers to spare one, it still takes on one geologist while it knows no ore, since without ore the smiths it saves hammers for never come.
- **Players and teams:** you and up to seven computer players: allies on your team, and enemies who either play as one team or each on their own. Only one human plays until online play (#2).
  - A map holds up to 4 players when small, 6 when medium and 8 when large; on islands 2, 4 and 5, as each island must hold a castle's land and its ore mountain.
  - With more than two players the castles stand on a ring around the middle, at least 32 tiles apart so no two castles' land overlaps, and the map is not mirrored. Each start gets the same prepared surroundings inside its own area.
  - Allies never fight each other, cannot attack each other's buildings, and see what each other sees. The last team with a castle wins; in the economic mode, the first player to make every target wins for the whole team.
  - On islands, the neutral middle island keeps a channel of sea to every player's island, and is left out where it would be too small. Before, on small two-player maps it could join the islands.
  - Computer players head for the nearest enemy castle, whose start the open setup shows, and leave allies alone.

## Cross-device army controls

- **Orders go anywhere:** soldiers, specialists and ships can be sent to any tile, explored or not, as in The Settlers III. Spells and trade route waypoints still need explored land. With units selected, a right-click on the minimap (or a tap on it while an order button is on) sends them there.
- **Breaking off a fight:** a soldier ordered to move while it is fighting breaks off and walks to the spot without turning back to the enemy. Soldiers not fighting still fight what they meet on the way, unless ordered to move without fighting. The computer player leaves its fighting soldiers to their fight.

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
