# CTD Plugin Preview v0.2.1

This is an experimental Codex ThreadDeck plugin preview.

It includes:

- a Codex plugin manifest;
- a ThreadDeck Skill whose frontmatter is broad enough for normal installed-project prompts;
- project-state detection;
- CTD intent compiler routing envelopes for ordinary user prompts;
- execution-surface recommendation;
- advisory auto-route lifecycle hook preview;
- runtime doctor diagnostics for Skill/plugin/hook/project-kit readiness;
- reviewed user-level hook installer and rollback helper;
- hidden CTD Home history-vault preview;
- safe dispatch-plan generation from the latest routing decision.

## Important Boundary

This package does not claim that CTD can inject thread tools into ordinary Codex conversations. Real cross-thread dispatch still depends on the current Codex environment exposing the required thread tools.

The intent compiler treats normal user tasks in installed CTD projects as routable CTD intent. It creates a routing envelope that distinguishes current-conversation work, bounded Codex native subagents, persistent visible worker conversations, and manual TaskCards. It does not require a startup phrase.

The hook preview is advisory only. After trust review, it may record `.threaddeck/last-routing-decision.json` and `.threaddeck/routing-decisions.jsonl`; it does not rewrite prompts, create threads, or dispatch messages.

The runtime doctor can report whether the Skill default trigger is ready. If it says `Skill default trigger: too narrow`, repair or reinstall the plugin package before expecting normal prompts to route through CTD.

High-risk release, deploy, account, credential, destructive, or private-repository actions remain behind explicit confirmation and may be routed to manual TaskCards instead of automatic subagents.

Use the project kit package for project-level CTD state installation.
