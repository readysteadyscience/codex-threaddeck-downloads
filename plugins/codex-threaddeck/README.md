# CTD Plugin Preview v0.2.0

This is an experimental Codex ThreadDeck plugin preview.

It is included to preview the planned product shape:

- project-state detection;
- read-only project-state detector script;
- execution-surface recommendation;
- advisory auto-route lifecycle hook preview;
- CTD adoption checks;
- minimal-confirmation bootstrap recommendations only when persistent worker coordination is useful;
- TaskCard rendering;
- ShortReport parsing;
- registry validation;
- status board updates;
- handoff creation.

## Important Boundary

This package includes a local Codex plugin manifest, the ThreadDeck preview skill, a read-only project-state detector script, an execution-surface recommender, and a bundled lifecycle hook preview, but it is still experimental. It does not claim that CTD can inject thread tools into ordinary Codex conversations.

The hook preview is advisory only. After trust review, it may record `.threaddeck/last-routing-decision.json` and `.threaddeck/routing-decisions.jsonl`; it does not rewrite prompts, create threads, or dispatch messages.

Real cross-thread dispatch still depends on the current Codex environment exposing the required thread tools.

Use the project kit package for project-level CTD state installation.
