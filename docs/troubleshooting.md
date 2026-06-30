# Troubleshooting

## Package Verification Fails

Run checksum verification from the repository root:

```bash
shasum -a 256 -c checksums/SHA256SUMS
```

If verification fails, remove the package and download it again from the trusted distribution surface.

## Installer Refuses To Overwrite

The installer refuses to overwrite an existing `.threaddeck/` directory. Review the current project state first, then decide whether to merge manually or move the old directory aside.

## Hidden Directory Is Not Visible

On macOS Finder, press `Command+Shift+.` to show hidden directories. The CTD project state lives in `.threaddeck/`.

## Codex Cannot Dispatch To Other Conversations

Real dispatch requires the current Codex conversation to expose thread tools. If those tools are missing, CTD should explain the missing capability and use manual task cards or handoff files instead of pretending a message was sent.

## Legacy Manual Recovery

`Launch CTD` is a legacy/manual recovery phrase. Use it only for troubleshooting, compatibility recovery, or environments where plugin, hook, or default bootstrap support is unavailable.

Normal usage after installation is simply to keep working in Codex and ask for collaboration, workers, dispatch, status, or handoff when needed.
