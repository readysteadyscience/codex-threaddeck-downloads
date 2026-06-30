---
name: threaddeck
description: Detect Codex ThreadDeck project state and recommend the smallest safe execution surface for normal Codex tasks.
---

# ThreadDeck Preview Skill

This preview skill is an installable local CTD plugin surface.

Use it when a project already contains `.threaddeck/`, or when the user normally describes a task in a CTD-enabled project, asks to install CTD, coordinate Codex workers, inspect CTD status, create a task card, parse a short report, or prepare a handoff.

## Rules

1. For normal user tasks, first inspect the current project for `AGENTS.md` and `.threaddeck/`.
2. When available, run the read-only detector:

   ```bash
   node ../../scripts/detect-project-state.mjs --root . --intent "<current user task>" --format text
   ```

3. When available, recommend the smallest execution surface:

   ```bash
   node ../../scripts/recommend-execution-mode.mjs --state /tmp/project-state.json --intent "<current user task>" --capability multi_agent --format text
   ```

4. If CTD is not installed, recommend the project kit install path.
5. If CTD is partially installed, recommend repair before dispatch.
6. If CTD is installed, keep normal Codex work flowing; do not ask the user to remember a startup phrase.
7. Prefer the current conversation for small tasks.
8. Prefer Codex native subagents for bounded complex tasks when available.
9. Create or reuse visible worker conversations only for persistent roles, long-running maintenance, old-project migration, or context that must survive across tasks.
10. Every visible worker may use Codex native subagents inside its own task, with depth and count kept bounded.
11. Before real cross-thread dispatch, check whether the current conversation has thread tools.
12. If thread tools are unavailable, use manual task cards or handoff files.
13. Do not claim real cross-thread dispatch unless the current Codex environment exposes the needed tools.
14. High-risk actions require explicit user confirmation.

## Status

Experimental preview. This skill is installable as a local Codex plugin, and includes read-only project-state detection plus execution-surface recommendation. Production hooks and MCP tools are not included yet.
