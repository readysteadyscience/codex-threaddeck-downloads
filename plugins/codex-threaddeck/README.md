# CTD Plugin Preview v0.2.0

This is an experimental Codex ThreadDeck plugin preview.

It is included to preview the planned product shape:

- project-state detection;
- read-only project-state detector script;
- CTD intent compiler routing envelopes for ordinary user prompts;
- execution-surface recommendation;
- advisory auto-route lifecycle hook preview;
- safe dispatch-plan generation from the latest routing decision;
- CTD adoption checks;
- minimal-confirmation bootstrap recommendations only when persistent worker coordination is useful;
- TaskCard rendering;
- ShortReport parsing;
- registry validation;
- status board updates;
- handoff creation.

## Important Boundary

This package includes a local Codex plugin manifest, the ThreadDeck preview skill, a read-only project-state detector script, an execution-surface recommender, and a bundled lifecycle hook preview, but it is still experimental. It does not claim that CTD can inject thread tools into ordinary Codex conversations.

The intent compiler treats normal user tasks in installed CTD projects as routable CTD intent. It creates a routing envelope that distinguishes current-conversation work, bounded Codex native subagents, persistent visible worker conversations, and manual TaskCards. It does not require a startup phrase.

The hook preview is advisory only. After trust review, it may record `.threaddeck/last-routing-decision.json` and `.threaddeck/routing-decisions.jsonl`; it does not rewrite prompts, create threads, or dispatch messages.

The dispatch planner reads `.threaddeck/last-routing-decision.json` and `.threaddeck/thread-registry.yml`, then reports whether the controller should reuse a worker, run a harmless safety test, or ask the user to create/select a worker. It also does not create threads or send messages.

High-risk release, deploy, account, credential, destructive, or private-repository actions remain behind explicit confirmation and may be routed to manual TaskCards instead of automatic subagents.

Real cross-thread dispatch still depends on the current Codex environment exposing the required thread tools.

Use the project kit package for project-level CTD state installation.
