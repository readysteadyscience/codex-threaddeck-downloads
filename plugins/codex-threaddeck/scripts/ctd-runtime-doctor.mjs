#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nowIso, parseArgs, redactSensitive, resolveCtdHome, writeJson, writeText } from "./ctd-lib.mjs";

const FEATURE_NAMES = ["hooks", "plugins", "multi_agent", "plugin_hooks"];

function exists(absolutePath) {
  return fs.existsSync(absolutePath);
}

function statKind(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

function pathInfo(absolutePath) {
  return {
    path: absolutePath,
    exists: exists(absolutePath),
    kind: statKind(absolutePath),
  };
}

function readOptionalText(absolutePath, maxBytes = 1024 * 1024) {
  try {
    if (!absolutePath || path.basename(absolutePath) === "auth.json") return "";
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function parseSkillFrontmatter(text) {
  const trimmed = String(text || "").trimStart();
  if (!trimmed.startsWith("---")) {
    return {
      present: false,
      name: "",
      description: "",
    };
  }

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return {
      present: false,
      name: "",
      description: "",
    };
  }

  const frontmatter = trimmed.slice(3, end).trim();
  const fields = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return {
    present: true,
    name: fields.name || "",
    description: fields.description || "",
  };
}

function analyzeSkillTrigger(skillPath) {
  const text = readOptionalText(skillPath);
  const frontmatter = parseSkillFrontmatter(text);
  const description = frontmatter.description || "";
  const combined = `${description}\n${text}`;
  const requiredSignals = {
    mentionsNormalPrompts: /\b(normal|ordinary|default)\b|普通|默认/i.test(description),
    mentionsInstalledCtdOrProjectState: /installed|project|AGENTS\.md|\.threaddeck|ThreadDeck|CTD|项目/i.test(description),
    mentionsRouting: /routing|route|intent|dispatch|task card|handoff|subagent|路由|调度|派发/i.test(description),
    bodyHasDefaultIntentCompiler: /Default Intent Compiler|ordinary user prompts as CTD-routable|普通.*CTD/i.test(combined),
  };
  const ready = Boolean(frontmatter.present && description && Object.values(requiredSignals).every(Boolean));
  return {
    path: skillPath,
    exists: exists(skillPath),
    frontmatterPresent: frontmatter.present,
    name: frontmatter.name,
    description,
    defaultTriggerReady: ready,
    signals: requiredSignals,
  };
}

function normalizeStatus(value) {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";
  if (/^(enabled|enable|true|on|yes|active|available|present)$/i.test(text)) return "enabled";
  if (/^(disabled|disable|false|off|no|inactive|unavailable|missing)$/i.test(text)) return "disabled";
  return text;
}

function readCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || "",
    error: result.error ? result.error.code || result.error.message : "",
    output: redactSensitive(output),
  };
}

function collectJsonFeatureStatuses(value, statuses = {}) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonFeatureStatuses(item, statuses);
    return statuses;
  }
  if (!value || typeof value !== "object") return statuses;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-\s]+/g, "_").toLowerCase();
    if (FEATURE_NAMES.includes(normalizedKey)) {
      statuses[normalizedKey] = normalizeStatus(child);
    }
    collectJsonFeatureStatuses(child, statuses);
  }
  return statuses;
}

function parseFeatureLine(line, feature) {
  const aliases = new Set([
    feature,
    feature.replace(/_/g, "-"),
    feature.replace(/_/g, " "),
  ]);
  const lower = line.toLowerCase();
  if (![...aliases].some((alias) => lower.includes(alias))) return "";
  if (/\b(enabled|true|on|yes|active|available)\b/i.test(line)) return "enabled";
  if (/\b(disabled|false|off|no|inactive|unavailable)\b/i.test(line)) return "disabled";
  return "present";
}

function parseFeaturesOutput(output) {
  const statuses = Object.fromEntries(FEATURE_NAMES.map((name) => [name, "unknown"]));
  const text = String(output || "").trim();
  if (!text) return statuses;
  try {
    Object.assign(statuses, collectJsonFeatureStatuses(JSON.parse(text)));
    return statuses;
  } catch {
    // Fall through to text parsing.
  }
  for (const line of text.split(/\r?\n/)) {
    const columnMatch = line.trim().match(/^(\S+)\s+(.+?)\s+(true|false)$/);
    if (columnMatch && FEATURE_NAMES.includes(columnMatch[1])) {
      statuses[columnMatch[1]] = columnMatch[3] === "true" ? "enabled" : "disabled";
      continue;
    }
    if (columnMatch) continue;
    for (const feature of FEATURE_NAMES) {
      const status = parseFeatureLine(line, feature);
      if (status) statuses[feature] = status;
    }
  }
  return statuses;
}

function detectCli(skipCli) {
  if (skipCli) {
    return {
      skipped: true,
      available: "skipped",
      command: "codex",
      version: "",
      features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, "unknown"])),
      errors: [],
    };
  }

  const command = process.env.CODEX_CLI || "codex";
  const versionRun = readCli(command, ["--version"]);
  if (versionRun.error === "ENOENT") {
    return {
      skipped: false,
      available: false,
      command,
      version: "",
      features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, "unknown"])),
      errors: ["codex_cli_not_found"],
    };
  }

  const featuresRun = readCli(command, ["features", "list"]);
  return {
    skipped: false,
    available: versionRun.ok,
    command,
    version: versionRun.output.split(/\r?\n/)[0] || "",
    features: parseFeaturesOutput(featuresRun.output),
    errors: [
      ...(versionRun.ok ? [] : ["codex_version_failed"]),
      ...(featuresRun.ok ? [] : ["codex_features_list_failed"]),
    ],
  };
}

function listDirectories(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function looksLikePluginRoot(root) {
  return exists(path.join(root, "hooks", "hooks.json")) ||
    exists(path.join(root, ".codex-plugin", "plugin.json")) ||
    exists(path.join(root, "manifest.preview.json")) ||
    exists(path.join(root, "skills", "threaddeck", "SKILL.md"));
}

function discoverPluginRoot(codexHome, explicitPluginRoot) {
  if (explicitPluginRoot) return path.resolve(explicitPluginRoot);
  const cacheRoot = path.join(codexHome, "plugins", "cache", "readysteadyscience", "codex-threaddeck");
  const versionRoots = listDirectories(cacheRoot).filter(looksLikePluginRoot);
  if (versionRoots.length) return versionRoots[versionRoots.length - 1];
  if (looksLikePluginRoot(process.cwd())) return process.cwd();
  return cacheRoot;
}

function pluginFileStatus(pluginRoot, codexHome) {
  const installedSkillPath = path.join(pluginRoot, "skills", "threaddeck", "SKILL.md");
  const sourceSkillPath = path.join(pluginRoot, "skills", "codex-thread-dispatch", "SKILL.md");
  const skillPath = exists(installedSkillPath) ? installedSkillPath : sourceSkillPath;
  const cacheRoot = path.join(codexHome, "plugins", "cache", "readysteadyscience", "codex-threaddeck");
  const files = {
    manifest: pathInfo(path.join(pluginRoot, "manifest.preview.json")),
    codexPluginManifest: pathInfo(path.join(pluginRoot, ".codex-plugin", "plugin.json")),
    hooksJson: pathInfo(path.join(pluginRoot, "hooks", "hooks.json")),
    hookShell: pathInfo(path.join(pluginRoot, "hooks", "ctd-auto-route-hook.sh")),
    autoRouteScript: pathInfo(path.join(pluginRoot, "scripts", "ctd-auto-route-hook.mjs")),
    threaddeckSkill: pathInfo(skillPath),
  };
  const skillTrigger = analyzeSkillTrigger(files.threaddeckSkill.path);
  return {
    cacheRoot: pathInfo(cacheRoot),
    pluginRoot: pathInfo(pluginRoot),
    files,
    skillReady: files.threaddeckSkill.exists,
    skillTriggerReady: skillTrigger.defaultTriggerReady,
    skillTrigger,
    pluginFilesReady: exists(pluginRoot) && files.hooksJson.exists && files.hookShell.exists && files.autoRouteScript.exists,
  };
}

function parseTomlPluginBlock(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inBlock = false;
  let sawBlock = false;
  const block = [];
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inBlock = /plugins\."codex-threaddeck@readysteadyscience"|plugins\.codex-threaddeck|codex-threaddeck/i.test(header[1]);
      sawBlock = sawBlock || inBlock;
      continue;
    }
    if (inBlock) block.push(line);
  }
  if (!sawBlock) return { configured: /codex-threaddeck|readysteadyscience/i.test(text), enabled: "unknown", source: "" };
  const body = block.join("\n");
  if (/^\s*enabled\s*=\s*false\s*$/im.test(body) || /^\s*disabled\s*=\s*true\s*$/im.test(body)) {
    return { configured: true, enabled: false, source: "config.toml" };
  }
  if (/^\s*enabled\s*=\s*true\s*$/im.test(body) || body.trim() || sawBlock) {
    return { configured: true, enabled: true, source: "config.toml" };
  }
  return { configured: true, enabled: "unknown", source: "config.toml" };
}

function findPluginInJson(value) {
  if (Array.isArray(value)) {
    return value.map(findPluginInJson).find((item) => item.configured) || { configured: false, enabled: "unknown" };
  }
  if (!value || typeof value !== "object") return { configured: false, enabled: "unknown" };
  const entries = Object.entries(value);
  for (const [key, child] of entries) {
    const keyMatches = /codex-threaddeck|readysteadyscience/i.test(key);
    const childText = typeof child === "string" ? child : "";
    const valueMatches = /codex-threaddeck|readysteadyscience/i.test(childText);
    if (keyMatches || valueMatches) {
      let enabled = "unknown";
      if (child && typeof child === "object" && "enabled" in child) enabled = Boolean(child.enabled);
      if (child && typeof child === "object" && child.disabled === true) enabled = false;
      return { configured: true, enabled, source: "config.json" };
    }
    const found = findPluginInJson(child);
    if (found.configured) return found;
  }
  return { configured: false, enabled: "unknown" };
}

function detectPluginEnabled(codexHome) {
  const tomlPath = path.join(codexHome, "config.toml");
  const toml = readOptionalText(tomlPath);
  if (toml) {
    const parsed = parseTomlPluginBlock(toml);
    if (parsed.configured) {
      return {
        configured: true,
        enabled: parsed.enabled,
        source: tomlPath,
      };
    }
  }

  const jsonPath = path.join(codexHome, "config.json");
  const json = readOptionalText(jsonPath);
  if (json) {
    try {
      const parsed = findPluginInJson(JSON.parse(json));
      if (parsed.configured) {
        return {
          configured: true,
          enabled: parsed.enabled,
          source: jsonPath,
        };
      }
    } catch {
      return {
        configured: false,
        enabled: "unknown",
        source: jsonPath,
        error: "config_json_parse_failed",
      };
    }
  }

  return {
    configured: false,
    enabled: false,
    source: "",
  };
}

function detectUserHookCandidates(codexHome) {
  const candidates = [
    path.join(codexHome, "hooks", "hooks.json"),
    path.join(codexHome, "hooks", "ctd-auto-route-hook.sh"),
    path.join(codexHome, "hooks.json"),
  ].map(pathInfo);
  const configText = readOptionalText(path.join(codexHome, "config.toml"));
  const configMentionsCtdHook = /ctd-auto-route-hook|UserPromptSubmit|SessionStart/i.test(configText);
  return {
    candidates,
    configMentionsCtdHook,
    installed: candidates.some((candidate) => candidate.exists) || configMentionsCtdHook,
  };
}

function detectProjectKit(projectRoot) {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const agentsText = readOptionalText(agentsPath);
  const files = {
    agents: pathInfo(agentsPath),
    threaddeckDir: pathInfo(path.join(projectRoot, ".threaddeck")),
    registry: pathInfo(path.join(projectRoot, ".threaddeck", "thread-registry.yml")),
    readmeZh: pathInfo(path.join(projectRoot, ".threaddeck", "README.zh-CN.md")),
    activationZh: pathInfo(path.join(projectRoot, ".threaddeck", "activation.zh-CN.md")),
  };
  const agentsMentionsThreadDeck = /ThreadDeck|CTD|\.threaddeck/i.test(agentsText);
  const present = files.threaddeckDir.exists || agentsMentionsThreadDeck;
  return {
    projectRoot: pathInfo(projectRoot),
    files,
    agentsMentionsThreadDeck,
    present,
    missing: Object.entries(files).filter(([, info]) => !info.exists).map(([name]) => name),
  };
}

function detectCtdHome(options, projectRoot) {
  const home = resolveCtdHome(options);
  const projectHistory = path.join(projectRoot, ".threaddeck", "history");
  return {
    home: pathInfo(home),
    history: pathInfo(path.join(home, "history")),
    projectHistory: pathInfo(projectHistory),
    readOnlyCheck: true,
  };
}

function makeRecommendedAction({ cli, pluginFiles, pluginEnabled, userHooks, projectKit, runtimeHookAutoLoadUnverified }) {
  if (!cli.skipped && cli.available === false) return "install_or_fix_codex_cli_then_rerun_doctor";
  if (!pluginFiles.skillReady || !pluginFiles.pluginFilesReady) return "install_or_repair_ctd_plugin_files";
  if (!pluginFiles.skillTriggerReady) return "repair_ctd_skill_trigger_description";
  if (!pluginEnabled.configured || pluginEnabled.enabled === false) return "enable_ctd_plugin_or_verify_codex_plugin_installation";
  if (!projectKit.present) return "install_project_kit_for_target_project";
  if (userHooks.installed) return "continue_normal_codex_conversation_and_monitor_hook_output";
  if (runtimeHookAutoLoadUnverified) return "use_skill_default_routing_and_optionally_install_reviewed_hook";
  return "continue_normal_codex_conversation";
}

export function runRuntimeDoctor(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const pluginRoot = discoverPluginRoot(codexHome, options.pluginRoot);
  const cli = detectCli(Boolean(options.skipCli));
  const pluginFiles = pluginFileStatus(pluginRoot, codexHome);
  const pluginEnabled = detectPluginEnabled(codexHome);
  const userHooks = detectUserHookCandidates(codexHome);
  const projectKit = detectProjectKit(projectRoot);
  const ctdHome = detectCtdHome(options, projectRoot);
  const hookFeature = cli.features.hooks;
  const pluginHookFeature = cli.features.plugin_hooks;
  const runtimeHookAutoLoadUnverified =
    cli.skipped ||
    !["enabled", "present"].includes(hookFeature) ||
    !["enabled", "present"].includes(pluginHookFeature) ||
    !pluginFiles.pluginFilesReady;

  const conclusion = {
    skill_ready: pluginFiles.skillReady,
    skill_trigger_ready: pluginFiles.skillTriggerReady,
    plugin_files_ready: pluginFiles.pluginFilesReady,
    runtime_hook_auto_load_unverified: runtimeHookAutoLoadUnverified,
    user_hook_not_installed: !userHooks.installed,
    project_kit_present: projectKit.present,
    project_kit_missing: !projectKit.present,
    recommendedAction: "",
  };
  conclusion.recommendedAction = makeRecommendedAction({
    cli,
    pluginFiles,
    pluginEnabled,
    userHooks,
    projectKit,
    runtimeHookAutoLoadUnverified,
  });

  return redactSensitive({
    schemaVersion: "ctd.runtime-doctor.v1",
    checkedAt: nowIso(),
    mode: {
      readOnly: true,
      skippedCli: cli.skipped,
    },
    inputs: {
      codexHome,
      pluginRoot,
      projectRoot,
    },
    codexCli: cli,
    features: cli.features,
    ctdPlugin: {
      configured: pluginEnabled.configured,
      enabled: pluginEnabled.enabled,
      source: pluginEnabled.source,
    },
    plugin: {
      enabled: pluginEnabled,
      files: pluginFiles,
    },
    pluginFiles: {
      cacheRootExists: pluginFiles.cacheRoot.exists,
      pluginRootExists: pluginFiles.pluginRoot.exists,
      hooksJsonExists: pluginFiles.files.hooksJson.exists,
      hookShellExists: pluginFiles.files.hookShell.exists,
      autoRouteScriptExists: pluginFiles.files.autoRouteScript.exists,
      threaddeckSkillExists: pluginFiles.files.threaddeckSkill.exists,
      skillReady: pluginFiles.skillReady,
      skillTriggerReady: pluginFiles.skillTriggerReady,
      skillTrigger: pluginFiles.skillTrigger,
      pluginFilesReady: pluginFiles.pluginFilesReady,
    },
    hooks: {
      bundled: {
        hooksJson: pluginFiles.files.hooksJson,
        hookShell: pluginFiles.files.hookShell,
      },
      userLevel: userHooks,
    },
    projectKit,
    ctdHome,
    conclusion,
    conclusions: conclusion,
    boundaries: {
      doesNotSilentlyMutatePrompt: true,
      doesNotCreateThreads: true,
      doesNotDispatchMessages: true,
      doesNotWriteGlobalConfig: true,
      doesNotInstallHooks: true,
      highRiskActionsStillRequireConfirmation: true,
    },
  });
}

function renderText(report) {
  const lines = [
    "CTD runtime doctor",
    `Codex CLI: ${report.codexCli.skipped ? "skipped" : report.codexCli.available ? `available (${report.codexCli.version || "version unknown"})` : "not available"}`,
    `Features: hooks=${report.features.hooks}, plugins=${report.features.plugins}, multi_agent=${report.features.multi_agent}, plugin_hooks=${report.features.plugin_hooks}`,
    `CTD plugin enabled: ${report.plugin.enabled.enabled}`,
    `Plugin files ready: ${report.conclusion.plugin_files_ready ? "yes" : "no"}`,
    `Skill ready: ${report.conclusion.skill_ready ? "yes" : "no"}`,
    `Skill default trigger: ${report.conclusion.skill_trigger_ready ? "ready" : "too narrow"}`,
    `Bundled hooks: hooks.json=${report.hooks.bundled.hooksJson.exists ? "yes" : "no"}, ctd-auto-route-hook.sh=${report.hooks.bundled.hookShell.exists ? "yes" : "no"}`,
    `User hook installed: ${report.conclusion.user_hook_not_installed ? "no" : "yes"}`,
    `Project kit: ${report.conclusion.project_kit_present ? "present" : "missing"}`,
    `CTD Home: ${report.ctdHome.home.exists ? "present" : "missing"} (${report.ctdHome.home.path})`,
    `CTD history: ${report.ctdHome.history.exists ? "present" : "missing"}`,
    `Project history index dir: ${report.ctdHome.projectHistory.exists ? "present" : "missing"}`,
    `Runtime hook auto-load: ${report.conclusion.runtime_hook_auto_load_unverified ? "unverified" : "verified by available feature signals"}`,
    `Recommended action: ${report.conclusion.recommendedAction}`,
    "Boundaries: no prompt mutation, no thread creation, no dispatch, no global config writes, high-risk actions still require confirmation.",
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runRuntimeDoctor({
    codexHome: args.codexHome || args["codex-home"],
    pluginRoot: args.pluginRoot || args["plugin-root"],
    projectRoot: args.projectRoot || args["project-root"],
    home: args.home || args.ctdHome || args["ctd-home"],
    skipCli: args.skipCli || args["skip-cli"],
  });
  const format = args.format || (args.json ? "json" : "text");
  if (format === "json") {
    writeJson(args.output, report);
  } else {
    writeText(args.output, renderText(report));
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
