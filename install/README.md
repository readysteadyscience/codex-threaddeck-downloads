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

After installation, keep using Codex normally. CTD should be discovered from the project files. When the task benefits from controller and worker collaboration, Codex can inspect CTD state and recommend a minimal-confirmation bootstrap.

## Existing Projects

If `.threaddeck/` already exists, the installer stops. Merge manually or move the old directory aside only after reviewing the existing project state.

## Experimental Plugin Preview

`ctd-plugin-v0.2.0.zip` is a beta preview skeleton, not a production plugin. Use it only to inspect the planned plugin shape.
