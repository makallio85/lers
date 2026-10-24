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
