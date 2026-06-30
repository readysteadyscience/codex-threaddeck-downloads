#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asArray, nowIso, parseArgs, parseSimpleYaml, redactSensitive, trimForState, writeJson, writeText } from "./ctd-lib.mjs";

export function detectProjectState(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const intent = trimForState(options.intent || "");
  const threadTools = new Set(
    asArray(options.threadTools || options.thread_tools || options["thread-tools"] || options.tool)
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readOptional(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return "";
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return "";
  }
}

function readRegistry(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    return { ok: false, error: "missing" };
  }
  try {
    return { ok: true, value: parseSimpleYaml(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function hasThreadTool(name) {
  if (!threadTools.size) return "unknown";
  return threadTools.has(name);
}

function detectIntentComplexity(text) {
  if (!text) return "unknown";
  const complexPattern = /(release|publish|deploy|test|refactor|migrate|docs?|README|CI|schema|registry|worker|controller|handoff|status|debug|fix|验证|测试|发布|部署|文档|重构|迁移|排查|总控|分控|短回传|状态板|交接)/i;
  return complexPattern.test(text) ? "collaboration_helpful" : "normal_work";
}

const registry = readRegistry(root, ".threaddeck/thread-registry.yml");
const agentsText = readOptional(root, "AGENTS.md");
const agentsExists = Boolean(agentsText);
const agentsThreadDeck = /(Codex\s+ThreadDeck|ThreadDeck|CTD|\.threaddeck)/i.test(agentsText);
const statusBoard = exists(root, ".threaddeck/status-board.json");
const tasks = exists(root, ".threaddeck/tasks.json");
const handoffs = exists(root, ".threaddeck/handoffs.json");
const artifacts = exists(root, ".threaddeck/artifacts.json");
const projectKitFiles = {
  agents: agentsExists,
  agentsThreadDeck,
  threaddeckDir: exists(root, ".threaddeck"),
  registry: registry.ok,
  readme: exists(root, ".threaddeck/README.zh-CN.md") || exists(root, ".threaddeck/README.md"),
  statusBoard,
  tasks,
  handoffs,
  artifacts,
};

const missing = Object.entries(projectKitFiles)
  .filter(([, present]) => !present)
  .map(([key]) => key);

let adoption = "not_installed";
if (projectKitFiles.threaddeckDir || projectKitFiles.agentsThreadDeck) {
  adoption = missing.length ? "partial" : "installed";
}

const registryValue = registry.value || {};
const controller = registryValue.controller || {};
const workers = Array.isArray(registryValue.workers) ? registryValue.workers : [];
const activeWorkers = workers.filter((worker) => worker.status === "active" || worker.status === "tested");
const requiredDispatchTools = ["list_threads", "read_thread", "send_message_to_thread"];
const dispatchToolStatus = Object.fromEntries(requiredDispatchTools.map((tool) => [tool, hasThreadTool(tool)]));
const threadToolsReady = requiredDispatchTools.every((tool) => dispatchToolStatus[tool] === true);
const intentClass = detectIntentComplexity(intent);

let recommendedAction = "continue_normal_codex_work";
let reason = "project is CTD-ready and the current task does not obviously require multiple workers";

if (adoption === "not_installed") {
  recommendedAction = "install_project_kit";
  reason = "CTD project files were not found";
} else if (adoption === "partial") {
  recommendedAction = "repair_project_kit";
  reason = `CTD appears partially installed; missing: ${missing.join(", ")}`;
} else if (!registry.ok) {
  recommendedAction = "repair_thread_registry";
  reason = `thread registry is not readable: ${registry.error}`;
} else if (!controller.title) {
  recommendedAction = "recommend_controller_bootstrap";
  reason = "registry exists but no controller title is recorded";
} else if (intentClass === "collaboration_helpful" && threadToolsReady) {
  recommendedAction = "recommend_minimal_confirmation_dispatch";
  reason = "task appears collaboration-friendly and required thread tools were reported as available";
} else if (intentClass === "collaboration_helpful") {
  recommendedAction = "recommend_minimal_confirmation_bootstrap_or_manual_task_cards";
  reason = "task appears collaboration-friendly; thread tool availability is unknown or incomplete";
}

return redactSensitive({
  schemaVersion: "ctd.project-state.v1",
  checkedAt: nowIso(),
  root,
  projectName: registryValue.project?.name || path.basename(root),
  adoption,
  projectKitFiles,
  missing,
  registry: {
    ok: registry.ok,
    error: registry.ok ? "" : registry.error,
    path: ".threaddeck/thread-registry.yml",
  },
  controller: {
    title: controller.title || "",
    role: controller.role || "",
    hasThreadId: Boolean(controller.thread_id || controller.threadId),
  },
  workers: {
    count: workers.length,
    activeCount: activeWorkers.length,
    roles: workers.map((worker) => worker.role).filter(Boolean),
  },
  status: {
    hasStatusBoard: statusBoard,
    hasTasksIndex: tasks,
    hasHandoffsIndex: handoffs,
    hasArtifactsIndex: artifacts,
  },
  threadTools: {
    provided: [...threadTools],
    requiredForDispatch: requiredDispatchTools,
    status: dispatchToolStatus,
    readyForDispatch: threadToolsReady,
  },
  executionPolicy: {
    autoTriggerFromNormalPrompts: true,
    preferSubagentsForComplexBoundedTasks: true,
    visibleWorkersForLongRunningRoles: true,
    maxSubagentsPerTask: 3,
    maxSubagentDepth: 1,
  },
  intent: {
    summary: intent,
    classification: intentClass,
  },
  recommendation: {
    action: recommendedAction,
    reason,
    requiresUserConfirmation: recommendedAction.includes("dispatch") || recommendedAction.includes("bootstrap"),
  },
});
}

function renderText(result) {
  const lines = [
    `CTD project state: ${result.adoption}`,
    `Project: ${result.projectName}`,
    `Registry: ${result.registry.ok ? "ok" : `not ok (${result.registry.error})`}`,
    `Controller: ${result.controller.title || "not recorded"}`,
    `Workers: ${result.workers.count} total, ${result.workers.activeCount} active/tested`,
    `Thread tools ready: ${result.threadTools.readyForDispatch ? "yes" : "no/unknown"}`,
    `Recommendation: ${result.recommendation.action}`,
    `Reason: ${result.recommendation.reason}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
const args = parseArgs(process.argv.slice(2));
const result = detectProjectState({
  root: args.root || args._[0] || process.cwd(),
  intent: args.intent || "",
  threadTools: args.threadTools || args.thread_tools || args["thread-tools"] || args.tool,
});
const format = args.format || (args.json ? "json" : "text");
if (format === "json") {
  writeJson(args.output, result);
} else {
  writeText(args.output, renderText(result));
}
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
