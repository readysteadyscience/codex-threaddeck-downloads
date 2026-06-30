# Install Codex ThreadDeck

The default install path is the project kit package.

## Install

```bash
unzip releases/v0.2.0/ctd-project-kit-v0.2.0.zip -d /tmp/ctd-project-kit
/tmp/ctd-project-kit/ctd-project-kit-v0.2.0/scripts/install-project-kit.sh /absolute/path/to/target-project
```

The target project should be the project currently opened in Codex.

## Expected Result

The installer creates or updates:

```text
AGENTS.md
.threaddeck/
```

Inside `.threaddeck/`, CTD stores project collaboration rules, a thread registry, status files, and bootstrap prompts.

## Normal Use

After installation, keep using Codex normally. CTD should be discovered from the project files. For each task, Codex can inspect CTD state and choose the smallest useful execution surface: the current conversation, Codex native subagents, visible long-running worker conversations, or manual TaskCards.

## Existing Projects

If `.threaddeck/` already exists, the installer stops. Merge manually or move the old directory aside only after reviewing the existing project state.

## Experimental Plugin Preview

`ctd-plugin-v0.2.0.zip` is a beta plugin preview. It includes a valid local Codex plugin manifest, the ThreadDeck preview skill, the read-only project-state detector, the execution-surface recommender, an advisory auto-route hook preview, and a dispatch planner. The hook must be reviewed/trusted in Codex before use. The hook and planner do not rewrite prompts, create threads, or dispatch messages.

For Codex CLI marketplace installation:

```bash
codex plugin marketplace add readysteadyscience/codex-threaddeck-downloads
codex plugin add codex-threaddeck@readysteadyscience
```

If marketplace installation is unavailable in your Codex environment, download and inspect the plugin package manually.
