# Working on Lers

Read README.md and docs/ before changing design. Use English throughout: player-facing UI, menus, tutorials, notifications, default bot messages, code, comments, issues, commits and documentation.

- Preserve the Settlers III-inspired gameplay flow and menu grouping; returning-player familiarity is an explicit product requirement.
- Use original implementation and licensed assets; never import proprietary Settlers code, images, interface artwork, maps, text or audio.
- Treat browser, iOS and Android as targets. Essential actions must have touch equivalents.
- Keep simulation rules independent of rendering, transports and model providers. All players use the same command validation and visibility rules.
- External MCP agents need an agent runner; do not describe MCP as autonomous AI by itself.
- Label planned capabilities and benchmark limitations honestly. Record measurement environment and workloads.
- Run `npm test` after simulation changes and `npm run benchmark` for performance-relevant changes. Expand tests when they establish meaningful behavior.
- Never commit secrets or mobile signing material. Keep third-party licenses and attribution.
- Keep CI small; avoid paid services or deployments unless requested. Submit implementation changes through focused pull requests.
