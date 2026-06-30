---
name: threaddeck
description: Detect Codex ThreadDeck project state and recommend the smallest safe controller or worker bootstrap when collaboration would help.
---

# ThreadDeck Preview Skill

This preview skill is a product skeleton for CTD.

Use it when a project already contains `.threaddeck/`, or when the user asks to install CTD, coordinate Codex workers, inspect CTD status, create a task card, parse a short report, or prepare a handoff.

## Rules

1. Inspect the current project for `AGENTS.md` and `.threaddeck/`.
2. If CTD is not installed, recommend the project kit install path.
3. If CTD is installed, let normal Codex work continue.
4. When the task benefits from multiple conversations, recommend a minimal-confirmation bootstrap.
5. Before real dispatch, check whether the current conversation has thread tools.
6. If thread tools are unavailable, use manual task cards or handoff files.
7. Do not claim real cross-thread dispatch unless the current Codex environment exposes the needed tools.
8. High-risk actions require explicit user confirmation.

## Status

Experimental preview. This skill is installable as a local Codex plugin, but production hooks and MCP tools are not included yet.
