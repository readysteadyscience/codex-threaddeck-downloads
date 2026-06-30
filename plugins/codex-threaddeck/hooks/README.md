# ThreadDeck Auto-Route Hook Preview

This directory contains a preview Codex lifecycle hook configuration for CTD.

## What It Does

- `SessionStart`: checks whether the current `cwd` looks like a CTD project.
- `UserPromptSubmit`: runs the project-state detector and execution-mode recommender for the submitted task.
- If `.threaddeck/` exists, writes:
  - `.threaddeck/last-routing-decision.json`
  - `.threaddeck/routing-decisions.jsonl`

## Boundaries

This hook is advisory only.

It does not:

- rewrite the user prompt;
- create Codex threads;
- send messages to worker conversations;
- install or update CTD;
- perform publish, deploy, git push, account, credential, payment, or destructive actions.

Real visible-worker dispatch still requires a tool-enabled controller conversation, user-visible routing, and any required confirmation.

## Trust

Codex requires non-managed hooks to be reviewed and trusted. After installing or changing this plugin, inspect hooks with the Codex `/hooks` surface and trust them only after reviewing the command and boundaries.

The first preview uses `hooks/hooks.json` because Codex documentation explicitly names that as a plugin-bundled lifecycle config path. Hook command path resolution for bundled plugins should be verified in the target Codex build before treating this as production behavior.
