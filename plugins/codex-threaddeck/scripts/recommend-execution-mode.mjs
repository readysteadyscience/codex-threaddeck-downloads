#!/usr/bin/env node
import path from "node:path";
import { asArray, nowIso, parseArgs, readJson, redactSensitive, trimForState, writeJson, writeText } from "./ctd-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const format = args.format || (args.json ? "json" : "text");
const state = args.state ? readJson(args.state) : {};
const intent = trimForState(args.intent || state.intent?.summary || args._.join(" "), 420);
const capabilities = new Set(
  asArray(args.capability || args.capabilities)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean),
);

function hasCapability(name) {
  return capabilities.has(name);
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyIntent(text) {
  const value = String(text || "");
  if (!value.trim()) return "unknown";

  const buckets = [];
  const checks = [
    ["release", /(release|tag|publish|deploy|upload|GitHub release|发版|发布|部署|推送|打 tag|打标签|上线|私有化|改 private)/i],
    ["docs", /(README|docs?|documentation|copy|release notes|文档|说明|发布说明|安装说明|官网|下载页)/i],
    ["testing", /(test|tests|CI|smoke|verify|validation|验收|复核|测试|验证|闸门)/i],
    ["migration", /(migrate|migration|retrofit|rename|archive|private repo|迁移|改造|归档|重命名|私有仓)/i],
    ["implementation", /(implement|fix|refactor|script|schema|parser|MCP|plugin|hook|修改|实现|修复|重构|脚本|插件|工具化)/i],
    ["investigation", /(research|inspect|audit|investigate|explore|look up|分析|研究|侦察|审计|排查|看一下)/i],
  ];

  for (const [bucket, pattern] of checks) {
    if (pattern.test(value)) buckets.push(bucket);
  }

  if (includesAny(value, [/(账号|凭证|token|cookie|password|secret|证书|签名|支付|客户|生产环境|删除|reset --hard|checkout --|destructive)/i])) {
    buckets.push("high_risk");
  }

  const unique = [...new Set(buckets)];
  if (unique.includes("high_risk")) return "high_risk";
  if (unique.length > 1) return "multi_domain";
  return unique[0] || "simple";
}

function isLongRunning(text) {
  return includesAny(String(text || ""), [
    /(长期|持续|每日|每周|维护|路线图|roadmap|release process|release maintenance|maintenance lane|maintain|发布流程|项目架构|多天|ongoing|recurring|controller|worker|总控|分控)/i,
  ]);
}

function isSmallTask(text) {
  return includesAny(String(text || ""), [
    /(small|minor|quick|tiny|one[- ]?line|typo|copy tweak|wording|simple|小|简单|轻微|文案|错别字|一行|一句话|顺手)/i,
  ]);
}

function requiresConfirmation(text, taskType) {
  const value = String(text || "");
  const planningOnly = /(plan|planning|maintenance|lane|checklist|draft|草案|计划|规划|维护|流程)/i.test(value);
  if (taskType === "high_risk") return true;
  if (taskType === "release" && !planningOnly) return true;
  const pattern = planningOnly
    ? /(push|tag|publish|deploy|upload|private|delete|archive|sign|notarize|payment|account|credential|部署|推送|打 tag|私有|删除|归档|签名|支付|账号|凭证)/i
    : /(push|tag|publish|deploy|upload|private|delete|archive|sign|notarize|payment|account|credential|发布|部署|推送|打 tag|私有|删除|归档|签名|支付|账号|凭证)/i;
  return includesAny(value, [pattern]);
}

function visibleWorkerRoles(taskType, text) {
  const value = String(text || "");
  const roles = [];
  const add = (role) => {
    if (!roles.includes(role)) roles.push(role);
  };

  if (taskType === "docs" || /README|docs?|文档|说明/i.test(value)) add("docs");
  if (taskType === "testing" || /test|CI|smoke|验收|测试|验证/i.test(value)) add("verification");
  if (taskType === "implementation" || /implement|fix|schema|script|plugin|MCP|实现|修复|脚本|插件/i.test(value)) add("implementation");
  if (taskType === "release" || /release|publish|tag|deploy|发版|发布|部署/i.test(value)) add("release");
  if (taskType === "investigation" || /research|audit|inspect|分析|研究|审计|侦察/i.test(value)) add("research");
  if (taskType === "migration" || /migrate|retrofit|archive|迁移|改造|归档/i.test(value)) add("migration");

  if (!roles.length && taskType === "multi_domain") {
    add("implementation");
    add("verification");
  }
  return roles.slice(0, 4);
}

function subagentsFor(taskType, text) {
  const agents = [];
  const add = (id, agentType, purpose) => {
    if (!agents.some((agent) => agent.id === id)) agents.push({ id, agentType, purpose });
  };

  if (taskType === "investigation" || /inspect|audit|research|分析|研究|审计|侦察/i.test(text)) {
    add("explore-context", "explorer", "read-only project/context exploration");
  }
  if (["implementation", "multi_domain", "docs", "testing"].includes(taskType)) {
    add("implement-or-draft", "worker", "bounded implementation or document update");
  }
  if (["testing", "multi_domain", "release", "high_risk"].includes(taskType)) {
    add("verify-risk", "explorer", "independent verification and risk scan");
  }
  return agents.slice(0, 3);
}

const adoption = state.adoption || args.adoption || "unknown";
const taskType = classifyIntent(intent);
const longRunning = isLongRunning(intent);
const confirmation = requiresConfirmation(intent, taskType);
const threadToolsReady = state.threadTools?.readyForDispatch === true || args.threadToolsReady === true || args["thread-tools-ready"] === true;
const multiAgentReady = hasCapability("multi_agent") || hasCapability("subagent") || args.multiAgent === true || args["multi-agent"] === true;
const readyProject = adoption === "installed" || adoption === "partial" || adoption === "unknown";
const smallTask = isSmallTask(intent);

let executionMode = "single_conversation";
let reason = "task appears small enough for the current conversation";
let fallback = "single_conversation";

if (adoption === "not_installed") {
  executionMode = "manual_task_cards";
  reason = "ThreadDeck project kit is not installed yet";
  fallback = "install_project_kit";
} else if (smallTask && !longRunning && !confirmation) {
  executionMode = "single_conversation";
  reason = "task appears small enough to complete directly in the current conversation";
  fallback = "single_conversation";
} else if (longRunning && threadToolsReady) {
  executionMode = "visible_worker_threads";
  reason = "task describes a long-running role, maintenance lane, or project-level architecture that benefits from visible persistent conversations";
  fallback = multiAgentReady ? "subagent_parallel" : "manual_task_cards";
} else if (["multi_domain", "implementation", "testing", "docs", "investigation"].includes(taskType) && multiAgentReady && readyProject && !confirmation) {
  executionMode = "subagent_parallel";
  reason = "task is bounded but complex enough to split inside the current conversation using Codex native subagents";
  fallback = "single_conversation";
} else if (["release", "high_risk", "migration"].includes(taskType)) {
  executionMode = threadToolsReady && longRunning ? "visible_worker_threads" : "subagent_parallel";
  reason = "task has release, migration, or high-risk signals and must stay behind explicit confirmation gates";
  fallback = "manual_task_cards";
} else if (["multi_domain", "implementation", "testing", "docs", "investigation"].includes(taskType)) {
  executionMode = "single_conversation";
  reason = "task is collaboration-friendly, but multi-agent capability was not reported";
  fallback = "manual_task_cards";
}

const result = redactSensitive({
  schemaVersion: "ctd.execution-recommendation.v1",
  recommendedAt: nowIso(),
  project: {
    name: state.projectName || path.basename(process.cwd()),
    adoption,
  },
  intent: {
    summary: intent,
    taskType,
    longRunning,
    smallTask,
  },
  capabilities: {
    multiAgentReady,
    threadToolsReady,
  },
  execution: {
    mode: executionMode,
    reason,
    fallback,
    requiresUserConfirmation: confirmation,
    autoTriggerAllowed: !confirmation && adoption !== "not_installed",
  },
  visibleWorkers: {
    createOnlyWhenPersistent: true,
    suggestedRoles: executionMode === "visible_worker_threads" ? visibleWorkerRoles(taskType, intent) : [],
  },
  subagents: {
    codexNative: true,
    useInsideVisibleWorkers: true,
    maxPerTask: Number(args.maxSubagents || args["max-subagents"] || state.executionPolicy?.maxSubagentsPerTask || 3),
    maxDepth: Number(args.maxDepth || args["max-depth"] || state.executionPolicy?.maxSubagentDepth || 1),
    suggested: executionMode === "subagent_parallel" ? subagentsFor(taskType, intent) : [],
  },
  policy: {
    autoTriggerFromNormalPrompts: true,
    preferSubagentsForComplexBoundedTasks: true,
    visibleWorkersForLongRunningRoles: true,
    noFixedDefaultWorkerSet: true,
    highRiskActionsRequireUserConfirmation: true,
  },
});

if (format === "json") {
  writeJson(args.output, result);
} else {
  const lines = [
    `CTD execution mode: ${result.execution.mode}`,
    `Task type: ${result.intent.taskType}`,
    `Reason: ${result.execution.reason}`,
    `Requires confirmation: ${result.execution.requiresUserConfirmation ? "yes" : "no"}`,
    `Auto trigger allowed: ${result.execution.autoTriggerAllowed ? "yes" : "no"}`,
    `Visible workers: ${result.visibleWorkers.suggestedRoles.length ? result.visibleWorkers.suggestedRoles.join(", ") : "none"}`,
    `Subagents: ${result.subagents.suggested.length ? result.subagents.suggested.map((agent) => `${agent.id}:${agent.agentType}`).join(", ") : "none"}`,
    `Fallback: ${result.execution.fallback}`,
  ];
  writeText(args.output, `${lines.join("\n")}\n`);
}
