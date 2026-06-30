# No Source Policy

This downloads repository is a distribution surface, not the CTD source repository.

It may contain:

- installable CTD packages;
- release metadata;
- release notes;
- checksums;
- beta marketplace metadata;
- troubleshooting docs.

It must not contain:

- Git history;
- private project paths;
- private project names;
- customer or account material;
- unreleased internal planning notes;
- sensitive auth material;
- machine-local handoff logs.

The source repository may remain private. Public users should be able to install and update CTD from packages without receiving source history.

## Package Boundary

The project kit package installs only `AGENTS.md` plus `.threaddeck/` into a target project. It does not keep the full CTD repository inside the target project.

The plugin preview package is experimental and must be labeled that way until a formal Codex plugin manifest and verified install surface exist.
