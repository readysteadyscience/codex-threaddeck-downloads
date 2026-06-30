# Codex ThreadDeck Downloads

This repository is the public download and update entrypoint for Codex ThreadDeck (CTD).

CTD is a Codex multi-thread collaboration control plane. It installs a small project kit into a project, lets Codex detect the project and task state, and recommends the smallest useful bootstrap when controller and worker coordination would help.

## Current Channel

- Latest stable version: `v0.2.0`
- Channel metadata: `channels/stable.json`
- Latest metadata: `latest.json`
- Release notes: `release-notes/v0.2.0.md`
- Checksums: `checksums/SHA256SUMS`

## Downloads

| Package | Purpose |
| --- | --- |
| `releases/v0.2.0/ctd-project-kit-v0.2.0.zip` | Public-safe project kit for installing `AGENTS.md` plus `.threaddeck/` into a target project. |
| `releases/v0.2.0/ctd-plugin-v0.2.0.zip` | Experimental Codex plugin preview with a valid local plugin manifest and ThreadDeck skill. |

## Install Flow

1. Download the project kit package.
2. Extract it outside the target project.
3. Run the included installer against the project currently opened in Codex.
4. Continue using Codex normally.

After installation, CTD does not replace Codex. It gives Codex durable project rules and local state files so Codex can detect the CTD setup, inspect collaboration status, and recommend a minimal-confirmation bootstrap when multi-window work is useful.

See `install/README.md` for exact commands.

## Source Policy

This downloads repository is not the source repository. It publishes installable packages, checksums, release notes, and beta marketplace metadata only.

See `docs/no-source-policy.md`.

## Experimental Marketplace Entry

Marketplace and deep-link installation are beta surfaces in this draft. The Codex CLI marketplace entry is available at `.agents/plugins/marketplace.json`; product metadata is documented under `marketplace/marketplace.json`.

```bash
codex plugin marketplace add readysteadyscience/codex-threaddeck-downloads
codex plugin add codex-threaddeck@readysteadyscience
```

## Verification

Verify package hashes before use:

```bash
shasum -a 256 -c checksums/SHA256SUMS
```
