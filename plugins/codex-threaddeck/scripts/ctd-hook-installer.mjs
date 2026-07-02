#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso, parseArgs, writeJson, writeText } from "./ctd-lib.mjs";

const SCHEMA_VERSION = "ctd.hook-installer.v1";
const MANIFEST_NAME = "ctd-hook-install.json";

function exists(absolutePath) {
  return fs.existsSync(absolutePath);
}

function readJsonIfExists(absolutePath) {
  if (!exists(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function discoverPluginRoot(explicitPluginRoot) {
  if (explicitPluginRoot) return path.resolve(explicitPluginRoot);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function timestamp() {
  return nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function makeHookJson(wrapperPath) {
  return {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          {
            type: "command",
            command: `${wrapperPath} --event SessionStart --format text`,
            timeout: 10,
            statusMessage: "Checking CTD project state",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `${wrapperPath} --event UserPromptSubmit --format text`,
            timeout: 10,
            statusMessage: "Checking CTD execution route",
          },
        ],
      },
    ],
  };
}

function mergeHooksJson(existing, wrapperPath) {
  const output = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const hooks = output.hooks && typeof output.hooks === "object" && !Array.isArray(output.hooks)
    ? { ...output.hooks }
    : {};
  const ctdHooks = makeHookJson(wrapperPath);

  for (const [eventName, entries] of Object.entries(ctdHooks)) {
    const currentEntries = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    hooks[eventName] = [
      ...currentEntries.filter((entry) => !/ctd-auto-route-hook|Checking CTD/i.test(JSON.stringify(entry))),
      ...entries,
    ];
  }

  output.hooks = hooks;
  return output;
}

function makeWrapper(pluginHookPath) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec ${shSingleQuote(pluginHookPath)} "$@"`,
    "",
  ].join("\n");
}

function isCtdManagedHookJson(absolutePath) {
  const text = exists(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
  return /ctd-auto-route-hook|Checking CTD project state|Checking CTD execution route/i.test(text);
}

function planFiles({ codexHome, pluginRoot, backupDir }) {
  const hooksDir = path.join(codexHome, "hooks");
  const manifestPath = path.join(hooksDir, MANIFEST_NAME);
  const wrapperPath = path.join(hooksDir, "ctd-auto-route-hook.sh");
  const hookJsonPath = path.join(codexHome, "hooks.json");
  const pluginHookPath = path.join(pluginRoot, "hooks", "ctd-auto-route-hook.sh");
  const backupRoot = backupDir || path.join(codexHome, "backups", "threaddeck-hooks", timestamp());
  return {
    hooksDir,
    manifestPath,
    wrapperPath,
    hookJsonPath,
    pluginHookPath,
    backupRoot,
  };
}

function backupTarget(sourcePath, backupRoot, label) {
  if (!exists(sourcePath)) return null;
  const backupPath = path.join(backupRoot, label);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

function ensureCanInstall(files, force) {
  const errors = [];
  if (!exists(files.pluginHookPath)) errors.push("plugin_hook_missing");
  const configPath = path.join(path.dirname(files.hookJsonPath), "config.toml");
  const configText = exists(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  if (/^\s*\[features\][\s\S]*?^\s*hooks\s*=\s*false\s*$/im.test(configText)) {
    errors.push("hooks_feature_disabled_in_config_toml");
  }
  if (/^\s*\[hooks(?:\.|\])|^\s*\[\[hooks\./im.test(configText) && !force) {
    errors.push("inline_hooks_in_config_toml_requires_manual_review_or_force");
  }
  if (exists(files.hookJsonPath)) {
    try {
      readJsonIfExists(files.hookJsonPath);
    } catch {
      errors.push("existing_hooks_json_parse_failed");
    }
  }
  if (exists(files.wrapperPath) && !isCtdManagedHookJson(files.wrapperPath) && !force) {
    errors.push("existing_non_ctd_hook_wrapper_requires_review_or_force");
  }
  return errors;
}

function installPlan(options) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const pluginRoot = discoverPluginRoot(options.pluginRoot);
  const files = planFiles({ codexHome, pluginRoot, backupDir: options.backupDir });
  const force = Boolean(options.force);
  const errors = ensureCanInstall(files, force);
  return {
    schemaVersion: SCHEMA_VERSION,
    plannedAt: nowIso(),
    mode: "install",
    apply: Boolean(options.apply),
    force,
    paths: {
      codexHome,
      pluginRoot,
      hooksDir: files.hooksDir,
      hookJsonPath: files.hookJsonPath,
      wrapperPath: files.wrapperPath,
      manifestPath: files.manifestPath,
      pluginHookPath: files.pluginHookPath,
      backupRoot: files.backupRoot,
    },
    checks: {
      pluginHookExists: exists(files.pluginHookPath),
      existingHookJson: exists(files.hookJsonPath),
      existingHookJsonLooksCtdManaged: isCtdManagedHookJson(files.hookJsonPath),
      existingWrapper: exists(files.wrapperPath),
      existingWrapperLooksCtdManaged: isCtdManagedHookJson(files.wrapperPath),
      manifestExists: exists(files.manifestPath),
    },
    actions: [
      "create_hooks_directory",
      "backup_existing_hooks_json_and_wrapper_when_present",
      "write_user_level_ctd_hook_wrapper",
      "write_user_level_hooks_json",
      "write_ctd_hook_install_manifest",
      "run_runtime_doctor_after_install",
    ],
    errors,
    boundaries: {
      dryRunByDefault: true,
      requiresApplyToWrite: true,
      doesNotEditCodexConfigToml: true,
      doesNotMutatePrompts: true,
      doesNotCreateThreads: true,
      doesNotDispatchMessages: true,
      rollbackRequiresApply: true,
    },
  };
}

function applyInstall(plan) {
  if (plan.errors.length) return { applied: false, skipped: true, reason: "plan_has_errors" };
  const files = plan.paths;
  fs.mkdirSync(files.hooksDir, { recursive: true });
  fs.chmodSync(files.hooksDir, 0o700);
  fs.mkdirSync(files.backupRoot, { recursive: true });

  const backups = {
    hookJson: backupTarget(files.hookJsonPath, files.backupRoot, "hooks.json.before"),
    wrapper: backupTarget(files.wrapperPath, files.backupRoot, "ctd-auto-route-hook.sh.before"),
    manifest: backupTarget(files.manifestPath, files.backupRoot, "ctd-hook-install.json.before"),
  };

  fs.writeFileSync(files.wrapperPath, makeWrapper(files.pluginHookPath), "utf8");
  fs.chmodSync(files.wrapperPath, 0o700);
  const existingHookJson = readJsonIfExists(files.hookJsonPath);
  fs.writeFileSync(files.hookJsonPath, `${JSON.stringify(mergeHooksJson(existingHookJson, files.wrapperPath), null, 2)}\n`, "utf8");
  fs.chmodSync(files.hookJsonPath, 0o600);
  fs.writeFileSync(
    files.manifestPath,
    `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      installedAt: nowIso(),
      pluginRoot: files.pluginRoot,
      hookJsonPath: files.hookJsonPath,
      wrapperPath: files.wrapperPath,
      backups,
      rollback: {
        command: "node scripts/ctd-hook-installer.mjs --rollback --apply",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  fs.chmodSync(files.manifestPath, 0o600);

  return {
    applied: true,
    backupRoot: files.backupRoot,
    wrote: [files.wrapperPath, files.hookJsonPath, files.manifestPath],
  };
}

function rollbackPlan(options) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const pluginRoot = discoverPluginRoot(options.pluginRoot);
  const files = planFiles({ codexHome, pluginRoot, backupDir: options.backupDir });
  const manifest = readJsonIfExists(files.manifestPath);
  const errors = [];
  if (!manifest) errors.push("ctd_hook_manifest_missing");
  return {
    schemaVersion: SCHEMA_VERSION,
    plannedAt: nowIso(),
    mode: "rollback",
    apply: Boolean(options.apply),
    paths: {
      codexHome,
      pluginRoot,
      hooksDir: files.hooksDir,
      hookJsonPath: files.hookJsonPath,
      wrapperPath: files.wrapperPath,
      manifestPath: files.manifestPath,
    },
    manifest,
    actions: [
      "restore_backed_up_hooks_json_when_available",
      "restore_backed_up_wrapper_when_available",
      "remove_ctd_installed_files_without_previous_backup",
      "remove_ctd_hook_install_manifest",
    ],
    errors,
    boundaries: {
      dryRunByDefault: true,
      requiresApplyToWrite: true,
      doesNotEditCodexConfigToml: true,
    },
  };
}

function restoreOrRemove(targetPath, backupPath) {
  if (backupPath && exists(backupPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(backupPath, targetPath);
    return "restored";
  }
  if (exists(targetPath)) fs.rmSync(targetPath, { force: true });
  return "removed";
}

function applyRollback(plan) {
  if (plan.errors.length) return { applied: false, skipped: true, reason: "plan_has_errors" };
  const manifest = plan.manifest;
  const backups = manifest.backups || {};
  const hookJsonPath = manifest.hookJsonPath || plan.paths.hookJsonPath;
  const wrapperPath = manifest.wrapperPath || plan.paths.wrapperPath;
  const results = {
    hookJson: restoreOrRemove(hookJsonPath, backups.hookJson),
    wrapper: restoreOrRemove(wrapperPath, backups.wrapper),
  };
  fs.rmSync(plan.paths.manifestPath, { force: true });
  return {
    applied: true,
    results,
    removedManifest: plan.paths.manifestPath,
  };
}

function renderText(report) {
  const lines = [
    `CTD hook installer (${report.mode})`,
    `Apply: ${report.apply ? "yes" : "no, dry-run only"}`,
    `Hook JSON: ${report.paths.hookJsonPath}`,
    `Wrapper: ${report.paths.wrapperPath}`,
    `Manifest: ${report.paths.manifestPath}`,
  ];
  if (report.paths.pluginHookPath) lines.push(`Plugin hook: ${report.paths.pluginHookPath}`);
  if (report.errors.length) lines.push(`Errors: ${report.errors.join(", ")}`);
  lines.push(`Actions: ${report.actions.join(", ")}`);
  if (report.result) {
    lines.push(`Result: ${report.result.applied ? "applied" : "not applied"}`);
    if (report.result.backupRoot) lines.push(`Backup: ${report.result.backupRoot}`);
  }
  lines.push("Boundaries: dry-run by default, no config.toml edits, no prompt mutation, no thread creation, no dispatch.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    apply: Boolean(args.apply),
    force: Boolean(args.force),
    rollback: Boolean(args.rollback),
    codexHome: args.codexHome || args["codex-home"],
    pluginRoot: args.pluginRoot || args["plugin-root"],
    backupDir: args.backupDir || args["backup-dir"],
  };
  const report = options.rollback ? rollbackPlan(options) : installPlan(options);
  if (options.apply) {
    report.result = options.rollback ? applyRollback(report) : applyInstall(report);
  }
  const format = args.format || (args.json ? "json" : "text");
  if (format === "json") writeJson(args.output, report);
  else writeText(args.output, renderText(report));
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
