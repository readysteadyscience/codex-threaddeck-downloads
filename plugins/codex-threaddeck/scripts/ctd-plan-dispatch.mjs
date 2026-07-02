#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asArray, nowIso, parseArgs, parseSimpleYaml, readJson, readText, redactSensitive, trimForState, writeJson, writeText } from "./ctd-lib.mjs";

const ACTIVE_STATUSES = new Set(["active", "tested"]);
const PLANNED_STATUSES = new Set(["planned", "candidate"]);
const ARCHIVE_CANDIDATE_STATUSES = new Set(["completed", "archived"]);
const OVERLOADED_CONTEXT_STATUSES = new Set(["long", "full", "stale", "context_too_long", "handoff_required"]);

function inferRolesFromText(text) {
  const value = String(text || "");
  const roles = [];
  const add = (role) => {
    if (!roles.includes(role)) roles.push(role);
  };
  if (/(Base URL|provider|relay|gateway|model|Claude|第三方|中转|模型|实例|执行链路)/i.test(value)) add("third-party");
  if (/(sync|history|catalog|project|session|state_5|项目同步|项目|历史|侧栏)/i.test(value)) add("sync");
  if (/(README|docs?|release notes|copy|文档|说明|发布说明)/i.test(value)) add("docs");
  if (/(test|CI|smoke|verify|validation|验收|测试|验证|闸门)/i.test(value)) add("verification");
  if (/(implement|fix|refactor|script|schema|parser|MCP|plugin|hook|修改|实现|修复|重构|脚本|插件|工具化)/i.test(value)) add("implementation");
  if (/(release|tag|publish|deploy|upload|发版|发布|部署|推送|上线)/i.test(value)) add("release");
  if (/(research|inspect|audit|investigate|explore|分析|研究|侦察|审计|排查)/i.test(value)) add("research");
  return roles;
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function roleTitle(role, workerPrefix = "↳") {
  const label = String(role || "worker")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${workerPrefix} ${label || "Worker"}`;
}

function roleMatches(requiredRole, worker) {
  const required = normalizeRole(requiredRole);
  const role = normalizeRole(worker.role);
  const title = normalizeRole(worker.title);
  const rawRole = String(worker.role || "").toLowerCase();
  const rawTitle = String(worker.title || "").toLowerCase();
  if (!required) return false;
  if (role === required || title.includes(required)) return true;
  const aliases = {
    implementation: ["impl", "develop", "dev", "code", "fix", "工程", "实现", "开发", "修复"],
    verification: ["test", "qa", "review", "验收", "测试", "验证", "复核"],
    docs: ["doc", "documentation", "文档"],
    release: ["publish", "deploy", "发版", "发布", "部署"],
    research: ["investigation", "audit", "analysis", "研究", "分析", "审计", "排查"],
    sync: ["project-sync", "history-sync", "项目同步", "历史同步", "同步"],
    "third-party": ["provider", "relay", "gateway", "claude", "cloud-hub", "第三方", "中转", "实例"],
  };
  return (aliases[required] || []).some((alias) => {
    const normalizedAlias = normalizeRole(alias);
    const rawAlias = String(alias).toLowerCase();
    return (normalizedAlias && (role.includes(normalizedAlias) || title.includes(normalizedAlias))) ||
      (rawAlias && (rawRole.includes(rawAlias) || rawTitle.includes(rawAlias)));
  });
}

function isSelfExecutionRisk(decision, mode, roles) {
  const text = `${decision.promptSummary || ""} ${decision.routingEnvelope?.promptSummary || ""}`;
  if (decision.execution?.requiresUserConfirmation === true) return true;
  if (mode === "manual_task_cards" || mode === "visible_worker_threads") return false;
  if (!roles.length) return false;
  return /(implement|fix|refactor|test|build|install|修改|实现|修复|重构|测试|构建|安装|本机安装|代码|文件)/i.test(text);
}

function workerContextStatus(worker) {
  return normalizeRole(worker.context_status || worker.contextStatus || worker.context || worker.lifecycle_context || "");
}

function workerLifecycle(worker) {
  return normalizeRole(worker.lifecycle || worker.lifecycle_status || worker.lifecycleStatus || "");
}

function needsReplacement(worker) {
  const contextStatus = workerContextStatus(worker);
  const lifecycle = workerLifecycle(worker);
  return worker.handoff_required === true ||
    worker.handoffRequired === true ||
    OVERLOADED_CONTEXT_STATUSES.has(contextStatus) ||
    ["replace", "replacement-needed", "replacement_required", "handoff-required"].includes(lifecycle);
}

function isArchiveCandidate(worker) {
  const status = String(worker.status || "").toLowerCase();
  const lifecycle = workerLifecycle(worker);
  return ARCHIVE_CANDIDATE_STATUSES.has(status) ||
    ["archive-candidate", "archive_after_handoff", "replaced", "legacy", "stale"].includes(lifecycle);
}

function readRegistry(file) {
  try {
    return { ok: true, value: parseSimpleYaml(readText(file)), error: "" };
  } catch (error) {
    return { ok: false, value: {}, error: error.message };
  }
}

export function planDispatch(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const decisionPath = options.decision || path.join(root, ".threaddeck", "last-routing-decision.json");
  const registryPath = options.registry || path.join(root, ".threaddeck", "thread-registry.yml");
  const decision = options.decisionValue || readJson(decisionPath);
  const registry = options.registryValue ? { ok: true, value: options.registryValue, error: "" } : readRegistry(registryPath);
  const registryValue = registry.value || {};
  const workerPrefix = registryValue.naming?.worker_prefix || registryValue.naming?.workerPrefix || "↳";
  const workers = Array.isArray(registryValue.workers) ? registryValue.workers : [];
  const requiredRoles = asArray(decision.visibleWorkers?.suggestedRoles).map(normalizeRole).filter(Boolean);
  const mode = decision.execution?.mode || "single_conversation";
  const routingEnvelope = decision.routingEnvelope || {};
  const inferredRoles = inferRolesFromText(`${decision.promptSummary || ""} ${routingEnvelope.promptSummary || ""}`);
  const requiredRoleSet = new Set([...requiredRoles, ...inferredRoles].map(normalizeRole).filter(Boolean));
  const allRequiredRoles = [...requiredRoleSet];
  const subagentPolicy = {
    codexNative: decision.subagents?.codexNative !== false,
    controllerMayUseSubagents: decision.subagents?.controllerMayUseSubagents !== false,
    workerMayUseSubagents: decision.subagents?.workerMayUseSubagents !== false && decision.subagents?.useInsideVisibleWorkers !== false,
    useInsideVisibleWorkers: decision.subagents?.useInsideVisibleWorkers !== false,
    autoUseForBoundedLowRiskTasks: decision.subagents?.autoUseForBoundedLowRiskTasks === true,
    requireBoundedScope: decision.subagents?.requireBoundedScope !== false,
    maxPerTask: Number(decision.subagents?.maxPerTask || 3),
    maxDepth: Number(decision.subagents?.maxDepth || 1),
    suggested: asArray(decision.subagents?.suggested),
  };

  const matchingWorkers = [];
  const overloadedWorkers = [];
  const plannedWorkers = [];
  const archiveCandidates = [];
  for (const worker of workers) {
    const role = normalizeRole(worker.role);
    if (isArchiveCandidate(worker)) {
      archiveCandidates.push({
        role,
        title: worker.title || roleTitle(role, workerPrefix),
        status: String(worker.status || "").toLowerCase() || "unknown",
        lifecycle: workerLifecycle(worker) || "archive_candidate",
        hasThreadId: Boolean(worker.thread_id || worker.threadId),
        cwd: worker.cwd || "",
        reason: worker.archive_reason || worker.archiveReason || "not active for current routing",
      });
    }
    if (![...requiredRoleSet].some((requiredRole) => roleMatches(requiredRole, worker))) continue;
    const status = String(worker.status || "").toLowerCase();
    const item = {
      role,
      title: worker.title || roleTitle(role, workerPrefix),
      status: status || "unknown",
      lifecycle: workerLifecycle(worker) || "current",
      contextStatus: workerContextStatus(worker) || "unknown",
      hasThreadId: Boolean(worker.thread_id || worker.threadId),
      cwd: worker.cwd || "",
      highRiskRequiresConfirmation: worker.high_risk_requires_confirmation === true,
      handoffRequired: needsReplacement(worker),
    };
    if (needsReplacement(worker)) overloadedWorkers.push(item);
    else if (ACTIVE_STATUSES.has(status)) matchingWorkers.push(item);
    else if (PLANNED_STATUSES.has(status)) plannedWorkers.push(item);
    else plannedWorkers.push(item);
  }

  const genericExecutionRoles = new Set(["implementation", "verification"]);
  const missingRoles = allRequiredRoles.filter((requiredRole) => {
    if (workers.some((worker) => roleMatches(requiredRole, worker))) return false;
    if (matchingWorkers.length && genericExecutionRoles.has(requiredRole)) return false;
    if (overloadedWorkers.length && genericExecutionRoles.has(requiredRole)) return false;
    return true;
  });
  const missingWorkers = missingRoles.map((role) => ({
    role,
    suggestedTitle: roleTitle(role, workerPrefix),
    reason: "no matching worker role is registered",
  }));

  let action = "continue_current_execution_mode";
  let summary = "routing decision does not require visible worker dispatch";
  if (mode === "visible_worker_threads") {
    if (!registry.ok) {
      action = "repair_registry_before_dispatch";
      summary = `thread registry is not readable: ${registry.error}`;
    } else if (matchingWorkers.length) {
      action = "prepare_task_card_for_existing_workers";
      summary = "at least one active/tested worker matches the routing decision";
    } else if (overloadedWorkers.length) {
      action = "create_replacement_worker_with_handoff";
      summary = "matching workers exist but need replacement because their context is too long or stale";
    } else if (plannedWorkers.length) {
      action = "run_safe_test_before_dispatch";
      summary = "matching workers exist but are not active/tested yet";
    } else {
      action = "request_user_confirmation_to_create_or_select_workers";
      summary = "routing decision requires a persistent visible worker, and no suitable worker is registered";
    }
  } else if (matchingWorkers.length && isSelfExecutionRisk(decision, mode, allRequiredRoles)) {
    action = "delegate_to_existing_worker_before_self_execution";
    summary = "an existing active/tested worker matches this implementation or verification task; controller should delegate before editing files";
  } else if (overloadedWorkers.length && isSelfExecutionRisk(decision, mode, allRequiredRoles)) {
    action = "create_replacement_worker_with_handoff";
    summary = "a matching worker exists but needs a fresh replacement before more implementation work";
  } else if (plannedWorkers.length && isSelfExecutionRisk(decision, mode, allRequiredRoles)) {
    action = "run_safe_test_before_dispatch";
    summary = "matching workers exist but are not active/tested yet; controller should test them before taking over execution";
  } else if (mode === "subagent_parallel") {
    action = "use_codex_native_subagents";
    summary = "routing decision prefers task-local Codex native subagents";
  } else if (mode === "manual_task_cards") {
    action = "create_manual_task_cards";
    summary = "routing decision prefers manual TaskCards or Handoffs";
  }

  const requiresUserConfirmation = [
    "request_user_confirmation_to_create_or_select_workers",
    "create_replacement_worker_with_handoff",
    "run_safe_test_before_dispatch",
    "repair_registry_before_dispatch",
  ].includes(action) || decision.execution?.requiresUserConfirmation === true;

  return redactSensitive({
    schemaVersion: "ctd.dispatch-plan.v1",
    plannedAt: nowIso(),
    root,
    sources: {
      decisionPath,
      registryPath,
      registryReadable: registry.ok,
      registryError: registry.error,
    },
    routingDecision: {
      event: decision.event || "",
      promptSummary: trimForState(decision.promptSummary || ""),
      routingEnvelope,
      executionMode: mode,
      recommendedAction: decision.recommendedAction || "",
      suggestedRoles: requiredRoles,
      inferredRoles,
      intentCompiler: decision.intentCompiler || {},
    },
    dispatch: {
      action,
      summary,
      requiresUserConfirmation,
      requiresThreadTools: mode === "visible_worker_threads" ||
        ["delegate_to_existing_worker_before_self_execution", "create_replacement_worker_with_handoff"].includes(action),
      doesNotCreateThreads: true,
      doesNotDispatchMessages: true,
      controllerSelfExecutionRisk: isSelfExecutionRisk(decision, mode, allRequiredRoles),
      controllerMustExplainSelfExecution: isSelfExecutionRisk(decision, mode, allRequiredRoles) && !matchingWorkers.length,
    },
    executionLayers: {
      currentConversation: true,
      codexNativeSubagents: mode === "subagent_parallel" || subagentPolicy.codexNative,
      visibleWorkerThreads: mode === "visible_worker_threads",
      manualTaskCards: mode === "manual_task_cards",
      controllerMayUseSubagents: subagentPolicy.controllerMayUseSubagents,
      visibleWorkersMayUseSubagents: subagentPolicy.workerMayUseSubagents,
      visibleWorkersArePersistentRoles: true,
      visibleWorkersAreNotDefaultPerTask: true,
      existingWorkersPreferredBeforeControllerEdits: matchingWorkers.length > 0 && isSelfExecutionRisk(decision, mode, allRequiredRoles),
      replacementWorkersUseHandoffNotFork: overloadedWorkers.length > 0,
      archiveUnusedWorkersWhenSafe: archiveCandidates.length > 0,
    },
    workers: {
      matchingActive: matchingWorkers,
      matchingOverloaded: overloadedWorkers,
      matchingPlanned: plannedWorkers,
      missing: missingWorkers,
      archiveCandidates,
    },
    workerLifecycle: {
      createWhenMissing: missingWorkers.length > 0 && ["visible_worker_threads", "manual_task_cards"].includes(mode),
      replaceWhenContextTooLong: overloadedWorkers.length > 0,
      replacementUsesFork: false,
      replacementUsesHandoff: true,
      archiveUnusedAfterHandoff: archiveCandidates.length > 0 || overloadedWorkers.length > 0,
      keepProjectSidebarClean: true,
    },
    subagentPolicy,
    taskCardDefaults: {
      workerMayUseSubagents: subagentPolicy.workerMayUseSubagents,
      subagentPlan: subagentPolicy.suggested,
      executionRequirements: [
        "Use the current conversation for small local steps.",
        "Use Codex native subagents only for bounded, low-risk subtasks when available.",
        "Visible workers are for persistent role context, not short one-off work.",
      ],
    },
    nextSteps: nextSteps(action, matchingWorkers, plannedWorkers, missingWorkers, archiveCandidates),
  });
}

function withArchiveCleanup(steps, archiveCandidates) {
  if (!archiveCandidates.length) return steps;
  return [
    ...steps,
    "After the active handoff or dispatch is safe, archive completed, replaced, legacy, or unused workers to keep the project sidebar clean.",
  ];
}

function nextSteps(action, matchingWorkers, plannedWorkers, missingWorkers, archiveCandidates = []) {
  if (action === "delegate_to_existing_worker_before_self_execution") {
    return withArchiveCleanup([
      "Read the matching worker thread status before dispatch.",
      "Send a bounded TaskCard to the existing worker instead of editing files in the controller.",
      "Allow the worker to use Codex native subagents inside its task when bounded and low risk.",
      "Controller should only summarize, verify, and decide follow-up after receiving a ShortReport.",
    ], archiveCandidates);
  }
  if (action === "prepare_task_card_for_existing_workers") {
    return withArchiveCleanup([
      "Read the matching worker thread status before dispatch.",
      "Render a bounded TaskCard for the selected worker and include workerMayUseSubagents when appropriate.",
      "Send only after confirming the worker is idle or willing to receive the task.",
      "Require a ShortReport response and update the status board.",
    ], archiveCandidates);
  }
  if (action === "create_replacement_worker_with_handoff") {
    return withArchiveCleanup([
      "Create or select a fresh replacement worker for the same role when thread tools and policy allow.",
      "Do not fork the old worker; pass only continuity state, Handoff, evidence paths, open tasks, risk boundaries, and the first next step.",
      "Mark the old worker read-only or archive-candidate after handoff.",
      "Archive replaced or unused workers after the replacement is active and the user-visible project sidebar is clean.",
    ], archiveCandidates);
  }
  if (action === "run_safe_test_before_dispatch") {
    return withArchiveCleanup([
      `Run a harmless safety test for: ${plannedWorkers.map((worker) => worker.title).join(", ")}`,
      "Mark workers active/tested only after a successful reply.",
      "Do not send real work until the safety test passes.",
    ], archiveCandidates);
  }
  if (action === "request_user_confirmation_to_create_or_select_workers") {
    return withArchiveCleanup([
      `Create or ask for minimal confirmation to create/select: ${missingWorkers.map((worker) => worker.suggestedTitle).join(", ")}`,
      "Use create_thread only when the current Codex surface allows it; otherwise provide a manual TaskCard.",
      "After confirmation, create or register the worker, then run a harmless safety test.",
    ], archiveCandidates);
  }
  if (action === "use_codex_native_subagents") {
    return withArchiveCleanup([
      "Use bounded Codex native subagents if available.",
      "If an appropriate persistent worker already exists, prefer dispatching a TaskCard to that worker before controller self-execution.",
      "If the controller self-executes, state the delegation check and reason explicitly.",
    ], archiveCandidates);
  }
  if (action === "create_manual_task_cards") {
    return withArchiveCleanup(["Create a manual TaskCard or Handoff; do not claim real dispatch occurred."], archiveCandidates);
  }
  if (action === "repair_registry_before_dispatch") {
    return withArchiveCleanup(["Repair or reinstall the CTD registry before visible-worker dispatch."], archiveCandidates);
  }
  return withArchiveCleanup(["Continue in the current execution mode."], archiveCandidates);
}

function renderText(plan) {
  const lines = [
    `CTD dispatch plan: ${plan.dispatch.action}`,
    `Execution mode: ${plan.routingDecision.executionMode}`,
    `Summary: ${plan.dispatch.summary}`,
    `Requires confirmation: ${plan.dispatch.requiresUserConfirmation ? "yes" : "no"}`,
    `Requires thread tools: ${plan.dispatch.requiresThreadTools ? "yes" : "no"}`,
    `Controller self-execution risk: ${plan.dispatch.controllerSelfExecutionRisk ? "yes" : "no"}`,
    `Active workers: ${plan.workers.matchingActive.length ? plan.workers.matchingActive.map((worker) => worker.title).join(", ") : "none"}`,
    `Overloaded workers: ${plan.workers.matchingOverloaded.length ? plan.workers.matchingOverloaded.map((worker) => worker.title).join(", ") : "none"}`,
    `Planned workers: ${plan.workers.matchingPlanned.length ? plan.workers.matchingPlanned.map((worker) => worker.title).join(", ") : "none"}`,
    `Missing workers: ${plan.workers.missing.length ? plan.workers.missing.map((worker) => worker.suggestedTitle).join(", ") : "none"}`,
    `Archive candidates: ${plan.workers.archiveCandidates.length ? plan.workers.archiveCandidates.map((worker) => worker.title).join(", ") : "none"}`,
    `Replacement uses fork: ${plan.workerLifecycle.replacementUsesFork ? "yes" : "no"}`,
    `Replacement uses handoff: ${plan.workerLifecycle.replacementUsesHandoff ? "yes" : "no"}`,
    `Worker may use subagents: ${plan.subagentPolicy.workerMayUseSubagents ? "yes" : "no"}`,
    "Next steps:",
    ...plan.nextSteps.map((step) => `- ${step}`),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || args._[0] || process.cwd());
  const plan = planDispatch({
    root,
    decision: args.decision || args.routingDecision || args["routing-decision"],
    registry: args.registry,
  });
  if (args.format === "text") {
    writeText(args.output, renderText(plan));
  } else {
    writeJson(args.output, plan);
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
