#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asArray, nowIso, parseArgs, parseSimpleYaml, readJson, readText, redactSensitive, trimForState, writeJson, writeText } from "./ctd-lib.mjs";

const ACTIVE_STATUSES = new Set(["active", "tested"]);
const PLANNED_STATUSES = new Set(["planned", "candidate"]);

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
  const requiredRoleSet = new Set(requiredRoles);
  const routingEnvelope = decision.routingEnvelope || {};
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
  const plannedWorkers = [];
  for (const worker of workers) {
    const role = normalizeRole(worker.role);
    if (!requiredRoleSet.has(role)) continue;
    const status = String(worker.status || "").toLowerCase();
    const item = {
      role,
      title: worker.title || roleTitle(role, workerPrefix),
      status: status || "unknown",
      hasThreadId: Boolean(worker.thread_id || worker.threadId),
      cwd: worker.cwd || "",
      highRiskRequiresConfirmation: worker.high_risk_requires_confirmation === true,
    };
    if (ACTIVE_STATUSES.has(status)) matchingWorkers.push(item);
    else if (PLANNED_STATUSES.has(status)) plannedWorkers.push(item);
    else plannedWorkers.push(item);
  }

  const matchedRoles = new Set([...matchingWorkers, ...plannedWorkers].map((worker) => worker.role));
  const missingRoles = requiredRoles.filter((role) => !matchedRoles.has(role));
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
    } else if (plannedWorkers.length) {
      action = "run_safe_test_before_dispatch";
      summary = "matching workers exist but are not active/tested yet";
    } else {
      action = "request_user_confirmation_to_create_or_select_workers";
      summary = "routing decision requires persistent visible workers, but none are registered";
    }
  } else if (mode === "subagent_parallel") {
    action = "use_codex_native_subagents";
    summary = "routing decision prefers task-local Codex native subagents";
  } else if (mode === "manual_task_cards") {
    action = "create_manual_task_cards";
    summary = "routing decision prefers manual TaskCards or Handoffs";
  }

  const requiresUserConfirmation = [
    "request_user_confirmation_to_create_or_select_workers",
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
      intentCompiler: decision.intentCompiler || {},
    },
    dispatch: {
      action,
      summary,
      requiresUserConfirmation,
      requiresThreadTools: mode === "visible_worker_threads",
      doesNotCreateThreads: true,
      doesNotDispatchMessages: true,
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
    },
    workers: {
      matchingActive: matchingWorkers,
      matchingPlanned: plannedWorkers,
      missing: missingWorkers,
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
    nextSteps: nextSteps(action, matchingWorkers, plannedWorkers, missingWorkers),
  });
}

function nextSteps(action, matchingWorkers, plannedWorkers, missingWorkers) {
  if (action === "prepare_task_card_for_existing_workers") {
    return [
      "Read the matching worker thread status before dispatch.",
      "Render a bounded TaskCard for the selected worker and include workerMayUseSubagents when appropriate.",
      "Send only after confirming the worker is idle or willing to receive the task.",
      "Require a ShortReport response and update the status board.",
    ];
  }
  if (action === "run_safe_test_before_dispatch") {
    return [
      `Run a harmless safety test for: ${plannedWorkers.map((worker) => worker.title).join(", ")}`,
      "Mark workers active/tested only after a successful reply.",
      "Do not send real work until the safety test passes.",
    ];
  }
  if (action === "request_user_confirmation_to_create_or_select_workers") {
    return [
      `Ask the user to confirm creating or selecting: ${missingWorkers.map((worker) => worker.suggestedTitle).join(", ")}`,
      "Do not create threads silently.",
      "After confirmation, create or register the worker, then run a harmless safety test.",
    ];
  }
  if (action === "use_codex_native_subagents") {
    return ["Use bounded Codex native subagents if available; otherwise continue in the current conversation with CTD-aware structure."];
  }
  if (action === "create_manual_task_cards") {
    return ["Create a manual TaskCard or Handoff; do not claim real dispatch occurred."];
  }
  if (action === "repair_registry_before_dispatch") {
    return ["Repair or reinstall the CTD registry before visible-worker dispatch."];
  }
  return ["Continue in the current execution mode."];
}

function renderText(plan) {
  const lines = [
    `CTD dispatch plan: ${plan.dispatch.action}`,
    `Execution mode: ${plan.routingDecision.executionMode}`,
    `Summary: ${plan.dispatch.summary}`,
    `Requires confirmation: ${plan.dispatch.requiresUserConfirmation ? "yes" : "no"}`,
    `Requires thread tools: ${plan.dispatch.requiresThreadTools ? "yes" : "no"}`,
    `Active workers: ${plan.workers.matchingActive.length ? plan.workers.matchingActive.map((worker) => worker.title).join(", ") : "none"}`,
    `Planned workers: ${plan.workers.matchingPlanned.length ? plan.workers.matchingPlanned.map((worker) => worker.title).join(", ") : "none"}`,
    `Missing workers: ${plan.workers.missing.length ? plan.workers.missing.map((worker) => worker.suggestedTitle).join(", ") : "none"}`,
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
