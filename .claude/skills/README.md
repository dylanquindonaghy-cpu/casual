# UI skills

The design skills Dylan chose (2026-10-20), kept in the project so every session has them. Use them
for any change to how a screen looks: a mock-up first, built only after Dylan approves it
(`CLAUDE.md`, "How to work each task"). Run them yourself with the Skill tool; Dylan can't type
slash commands.

| Skill | What it's for | Source | Licence |
|---|---|---|---|
| `frontend-design` | Distinctive, intentional visual choices; avoiding templated defaults | `anthropics/skills`, `skills/frontend-design` | Apache 2.0 (`LICENSE.txt`) |
| `design-taste-frontend` | Art direction and a real-browser inspector; for app screens read `references/app-screens.md` (its `--app` run). Includes what was `redesign-existing-projects` ("Redesign, restyle or review of an existing page or app screen") | `Leonxlnx/taste-skill`, `skills/taste-skill` (commit 6010f91) | MIT (`LICENSE`) |
| `ui-ux-pro-max` | Searchable styles, palettes, type pairings and UX rules | `nextlevelbuilder/ui-ux-pro-max-skill`, `.claude/skills/ui-ux-pro-max` (commit 56ea9cf) | MIT (`LICENSE`) |

Third-party files, copied as published: don't edit them here. To update one, in a scratch folder
run `npx skills add <source repo> --skill <name> -y`, read what changed, and copy the folder from
its `.agents/skills/<name>` over this one (keep the `LICENSE` file).
