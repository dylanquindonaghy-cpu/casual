# Start here: how to run this pack in Claude Code

Read this once on day one, then keep it open. It is written for you, not for Claude.

## 0. What you are actually doing

You are the manager. Claude Code is the builder. `PLAN.md` is the job list. `scripts/verify.sh`
and the `claims-auditor` agent are the inspector.

Your job each session: pick the next task, read the plan Claude proposes, say go, read the
inspector's report, commit. You never write code and you never grade the work yourself. The
inspector does that, and the hooks make sure nobody skips it.

## 1. One-off setup (about an hour)

**Windows:** use WSL2 (Ubuntu). The hooks are Linux shell scripts, and Node, Docker and Postgres
are smoother there. In PowerShell as administrator run `wsl --install`, restart, open "Ubuntu"
from the Start menu, set a username, then do everything below inside that Ubuntu window.
Install Docker Desktop for Windows and turn on "WSL integration" in its settings.

**Mac:** use Terminal. Install Homebrew first (brew.sh).

1. Tools.
   - Ubuntu/WSL: `sudo apt update && sudo apt install -y git jq curl unzip`, then install nvm
     (github.com/nvm-sh/nvm), close and reopen the terminal, then `nvm install 22`.
   - Mac: `brew install git jq node@22`, plus Docker Desktop.
   - Check: `node -v` (v22), `jq --version`, `docker --version`, `git --version`.
2. Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`. Open a new terminal, then
   `claude --version` and `claude doctor`. Needs a Pro or Max plan.
3. The project folder. The zip unpacks into a folder called `shiftdesk-starter`.
   ```
   cd ~
   unzip ~/Downloads/shiftdesk-starter-v4.zip        # WSL: /mnt/c/Users/<you>/Downloads/...
   cd shiftdesk-starter
   chmod +x scripts/*.sh .claude/hooks/*.sh
   cp .env.example .env
   git init && git add -A && git commit -m "starter pack v4"
   ```
   `ls -a` must show `CLAUDE.md`, `PLAN.md`, `docs`, `scripts` and `.claude` directly in this
   folder. If they are one level deeper, you unzipped into the wrong place.
4. Prove the safety net works on your machine before you trust it. Still in the terminal:
   `./scripts/selftest.sh`. Every line should say PASS and it should end with
   "SELFTEST PASSED". Each FAIL line tells you the fix (usually `jq` missing or `chmod`).
   It tests the hooks with fake payloads and cleans up after itself.
5. Start Claude Code from inside the folder, always: `claude`. Log in in the browser when asked.
   Then two checks inside Claude Code:
   - `/hooks` should list three hooks.
   - `/verify` should print NOT VERIFIED (nothing is built yet, so this is correct).
6. TypeScript language server plugin (Claude sees type errors as it edits). In a second terminal:
   `npm install -g typescript-language-server typescript`. In Claude Code:
   `/plugin install typescript-lsp@claude-plugins-official`. It does nothing until there is
   TypeScript code, so no output yet is normal.
7. Model. `/model`. Use Sonnet for building. Use Opus for the planning step at the start of each
   phase, or pick `opusplan` if your plan offers it (Opus in plan mode, Sonnet otherwise).
8. Permissions. Leave the default mode for the first week. After that, press Shift+Tab once for
   "accept edits" (file edits go through, shell commands still ask). Do not use bypass or
   skip-permissions on this project before Phase 3. The hooks still fire in that mode, but Claude
   can also run any shell command without asking.

## 2. Every session: the loop

1. `cd ~/shiftdesk-starter && claude`
2. First task of a new phase: paste that phase's **Kickoff prompt** from `PLAN.md`.
   Any other task: `/next-task`
3. Read the plan Claude proposes. It should name files and tests. If you don't understand a
   part: `Explain <thing> in plain English in 5 lines, then wait.`
   When you do: `Approved. Do exactly this plan, nothing extra.`
4. Watch the permission prompts. Approve file edits and npm, test and git commands. Stop and ask
   on anything that deletes files, pushes, or touches `.env`.
5. `/close-task`
6. Read the auditor's verdict block. DONE means go to step 7. NOT DONE means Claude fixes and
   re-runs, up to 3 rounds. After 3 rounds, stop for the night. Next session starts with the
   open items, not with a new task.
7. Commit: `Commit with the message "<task name>"`, or in the terminal
   `git add -A && git commit -m "<task name>"`.
8. `/log-hours 1.5 Phase 0 <what got done>` with your real hours.
9. `/clear`. Then the next task, or stop.

Phase 0 note: nothing can be ticked until `npm run typecheck`, `lint` and `test` exist and pass.
So Phase 0 closes as one block: build the scaffold, then `/close-task Phase 0` once. Expect
`/verify` to fail a few times while the scripts are being created. That is normal.

## 3. How to write a good prompt

Three checks before you press Enter:

1. Does it name the file or files to read? ("Read PLAN.md Phase 2 and docs/rules-and-credentials.md")
2. Is it one task?
3. Does it say what done looks like, or point at the phase's "Done when" line?

Good: `Read PLAN.md Phase 1, the task "Rate limit login requests", and the Login section of
docs/architecture.md. Propose the change and the tests. Wait for my OK.`

Bad: `make the login secure`

Phrases that cause fake progress. Never type these:

| Don't type | Type instead |
|---|---|
| "just make the tests pass" | `Find the root cause of the failing test. Explain the mechanism in 3 lines before changing anything.` |
| "skip that test for now" | Nothing. Tests are the evidence. A skipped test is a fail. |
| "continue" (without reading) | `Summarise in 3 lines: what's done, what's not, what's next.` Then decide. |
| "is it done?" | `/close-task`. The builder's opinion is not evidence. The auditor's verdict is. |
| "do Phases 1 and 2" | One task at a time. |
| "you're wrong, fix it" | Paste the exact error output. |
| "make it work like Deputy" | Point at the doc: `Follow docs/screens.md section X.` |

## 4. When it goes wrong

- Claude is going in circles or re-planning: press `Esc`. Then:
  `Stop planning. The plan is approved as written. Start with step 1 now.`
- It "fixed" one thing and broke another: `Esc`, then `Esc` `Esc` on an empty prompt opens the
  rewind menu. Go back to before the change. Or in the terminal `git checkout .` throws away
  everything since the last commit. This is why you commit after every closed task.
- The stop hook blocks Claude's final message: that is the hook doing its job. Claude claimed
  done without proof. Let it reword or run `/verify`.
- A hook blocks a tick: good. Run `/close-task`.
- Verify still failing after 3 rounds: stop. Next session:
  `Read the logs in .claude/state/. List the failures. For the first one, explain the root cause before proposing a fix.`
- Claude invents a library API (Drizzle, pg-boss, Next.js):
  `Check the official docs for <thing> with WebFetch before writing this.`
- Context nearly full (`/context` shows over about 70%): finish the task, `/close-task`, `/clear`.
  Use `/compact` only if you are mid-task and can't stop.
- Claude asks you to choose between options you don't understand:
  `Explain each option in plain English with one line on the risk. Recommend one. Which is
  simpler to test?` Take the recommendation unless it breaks a golden rule in CLAUDE.md.

## 5. Usage habits

- `/clear` between tasks. Never one endless session.
- Sonnet builds, Opus plans.
- The only subagents are the ones in the pack (`claims-auditor`, `guardrails-reviewer`,
  `doc-fact-checker`). No agent teams, no swarms.
- Work in 1 to 2 hour blocks. One task per block.
- `/usage` shows your limits. `/context` shows how full the conversation is.

## 6. Skills and plugins

Install now: `typescript-lsp` (step 6 above).

Optional, after Phase 0: two skills from Superpowers (MIT licence), copied by hand.
`systematic-debugging` (root cause before fixes) and `test-driven-development`. Don't install
the whole Superpowers plugin: it forces its own workflow, which overlaps with `/next-task` and
`/close-task`, and it adds tokens.

```
git clone --depth 1 https://github.com/obra/superpowers /tmp/sp
mkdir -p .claude/skills
cp -r /tmp/sp/skills/systematic-debugging /tmp/sp/skills/test-driven-development .claude/skills/
```

Then in Claude Code: `In .claude/skills/systematic-debugging/SKILL.md, replace the two lines that
mention superpowers:* skills with "run /close-task". Change nothing else.`

Your own `prompt-refiner` skill fits the phase kickoff prompts. Don't run it on `/next-task`;
that command already scopes the work.

Don't install: multi-agent frameworks, big MCP bundles, memory plugins. They eat usage and give
agents more ways to fool each other.

## 7. Your first week, literally

- Day 1 (weekend, 2 to 3 hours): section 1 setup. Then the Phase 0 kickoff prompt. Read the
  scaffold plan. Approve. Let it build.
- Days 2 to 4 (evenings, about 1.5 hours each): `/next-task` until Phase 0 is built. Then
  `/close-task Phase 0`. Commit. `/log-hours`.
- Day 5: create the GitHub repo and push (a Phase 0 task). CI must be green on the push.
- Weekend 2: Phase 1 kickoff prompt, with Opus for the plan. Read the schema and RLS plan slowly.
  This is the one place to take your time: tenancy is golden rule 2 and everything sits on it.
- Sell track, same week (PLAN.md week 1): first pilot firm conversation, 20 minutes with a contractor contact, the 30-firm
  list. No building past Phase 3 until Gate A is ticked.

## 8. Ten rules on a card

1. Always start `claude` inside the project folder.
2. One task per session. `/clear` after.
3. Point at files. Never describe from memory.
4. Plan, OK, build, `/close-task`, commit, log hours.
5. Read the auditor, not the builder.
6. Paste errors. Don't paraphrase them.
7. Never weaken a test.
8. `Esc` early. Rewind or `git checkout .`. Don't pile fixes on fixes.
9. No real employer data, ever, until the signed agreement.
10. Sell in week 1.
