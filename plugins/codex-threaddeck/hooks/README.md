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

Codex requires non-managed hooks to be reviewed and trusted. After installing or changing this plugin, inspect and trust hooks through the hook review/trust surface exposed by the current Codex runtime, when available, and trust them only after reviewing the command and boundaries.

The first preview uses `hooks/hooks.json` because Codex documentation explicitly names that as a plugin-bundled lifecycle config path. Hook command path resolution for bundled plugins should be verified in the target Codex build before treating this as production behavior.

## Runtime Doctor

Use the runtime doctor before claiming local default routing is fully available:

```bash
node scripts/ctd-runtime-doctor.mjs --project-root /absolute/path/to/your-project --format text
```

The doctor is read-only. It checks whether Codex CLI features, CTD plugin files, user hook config candidates, and project kit files are present. It reports plugin-bundled hook auto-loading as unverified unless the current runtime provides evidence for it.

## Opt-In User Hook Installer

If the runtime doctor reports that the Skill and plugin files are ready but user-level hooks are not installed, prepare a reviewed install plan first:

```bash
node scripts/ctd-hook-installer.mjs --format text
```

The installer is dry-run by default. It does not write `~/.codex`, install hooks, mutate prompts, create threads, or dispatch messages unless you rerun it with `--apply` after reviewing the plan.

When applied, it manages only CTD-owned files under the user hook directory:

- `hooks.json`
- `hooks/ctd-auto-route-hook.sh`
- `hooks/ctd-hook-install.json`

It does not edit `config.toml`. If `config.toml` already contains inline hook configuration or disables hooks, the installer stops for manual review. If `hooks.json` already exists, the installer merges the CTD block and preserves non-CTD hook entries.

Rollback is also explicit:

```bash
node scripts/ctd-hook-installer.mjs --rollback --apply
```

After install or rollback, rerun the runtime doctor and a disposable project smoke test before claiming default CTD routing is available in the current Codex runtime.
