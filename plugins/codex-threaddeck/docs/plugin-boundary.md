# ThreadDeck Plugin Boundary

This preview package is a public install and update surface for Codex ThreadDeck. It is not the private source repository.

## What The Plugin Preview Provides

- A Codex plugin manifest.
- A ThreadDeck Skill with default-trigger copy for normal installed-project prompts.
- Project-state detection scripts.
- CTD routing-envelope recommendation scripts.
- Runtime doctor diagnostics for plugin, Skill, hook, and project-kit readiness.
- A reviewed user-level hook installer with rollback support.
- A hidden CTD Home history-vault preview.
- Advisory dispatch planning from `.threaddeck/last-routing-decision.json` and the local registry.

## What It Does Not Provide

- It does not inject Codex thread tools into ordinary conversations.
- It does not silently rewrite prompts.
- It does not silently create workers, fork threads, archive threads, publish releases, deploy software, or perform account/credential actions.
- It does not bypass Codex permissions, hook trust review, or project safety rules.
- It does not expose the private source repository.

## Runtime Expectations

Codex may select the ThreadDeck Skill when the project or prompt matches the Skill description. The runtime doctor can help verify whether the Skill default trigger is broad enough for normal CTD routing.

User-level hooks, when installed and trusted, are advisory. They can record routing decisions in `.threaddeck/`, but they do not mutate prompts or perform cross-thread dispatch.

Real cross-thread dispatch requires the current Codex conversation to expose the relevant thread tools, such as listing, reading, creating, renaming, archiving, or messaging threads. If those tools are unavailable, CTD must fall back to TaskCards, Handoffs, and explicit user guidance.

## Recommended Public Wording

Use:

```text
Install CTD, continue using Codex normally, and let ThreadDeck detect project/task state and recommend the smallest safe execution surface.
```

Avoid claiming:

```text
CTD silently controls every Codex window or bypasses Codex tool limits.
```
