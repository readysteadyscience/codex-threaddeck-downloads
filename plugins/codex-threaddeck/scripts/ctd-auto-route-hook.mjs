#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { nowIso, parseArgs, readJson, readText, redactSensitive, trimForState, writeJson, writeText } from "./ctd-lib.mjs";
import { detectProjectState } from "./detect-project-state.mjs";
import { recommendExecutionMode } from "./recommend-execution-mode.mjs";

const args = parseArgs(process.argv.slice(2));
const event = String(args.event || args._[0] || process.env.CODEX_HOOK_EVENT || "UserPromptSubmit");
const cwd = path.resolve(args.cwd || process.env.PWD || process.cwd());
const inputText = readStdinSafe();
const hookInput = parseHookInput(inputText);
const prompt = trimForState(args.intent || args.prompt || hookInput.prompt || hookInput.userPrompt || hookInput.message || hookInput.input || "", 500);
const format = args.format || "json";

function readStdinSafe() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { input: trimmed };
  }
}

function hasProjectKit(root) {
  return fs.existsSync(path.join(root, ".threaddeck")) || /ThreadDeck|CTD|\.threaddeck/i.test(readOptional(path.join(root, "AGENTS.md")));
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function ensureThreaddeckDir(root) {
  const dir = path.join(root, ".threaddeck");
  if (!fs.existsSync(dir)) return "";
  return dir;
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function main() {
  const projectKitPresent = hasProjectKit(cwd);
  const state = detectProjectState({
    root: cwd,
    intent: prompt,
    threadTools: args.threadTools || args["thread-tools"] || "",
  });
  const recommendation = recommendExecutionMode({
    state,
    intent: prompt,
    capabilities: args.capability || args.capabilities || "multi_agent",
    threadToolsReady: args.threadToolsReady || args["thread-tools-ready"] || false,
  });

  const decision = redactSensitive({
    schemaVersion: "ctd.auto-route-hook.v1",
    checkedAt: nowIso(),
    event,
    cwd,
    projectKitPresent,
    promptSummary: prompt,
    adoption: state.adoption,
    recommendedAction: state.recommendation?.action || "",
    execution: recommendation.execution,
    visibleWorkers: recommendation.visibleWorkers,
    subagents: recommendation.subagents,
    advisory: makeAdvisory(state, recommendation),
    boundaries: {
      readOnlyHook: true,
      doesNotMutatePrompt: true,
      doesNotCreateThreads: true,
      doesNotDispatchMessages: true,
      highRiskStillRequiresConfirmation: true,
    },
  });

  const dir = ensureThreaddeckDir(cwd);
  if (dir && args["no-write"] !== true && args.noWrite !== true) {
    writeJson(path.join(dir, "last-routing-decision.json"), decision);
    appendJsonl(path.join(dir, "routing-decisions.jsonl"), decision);
  }

  if (format === "text") {
    writeText(args.output, `${decision.advisory}\n`);
    return;
  }
  writeJson(args.output, decision);
}

function makeAdvisory(state, recommendation) {
  if (state.adoption === "not_installed") {
    return "CTD project kit was not detected. Continue normally or install the project kit before expecting automatic CTD routing.";
  }
  const mode = recommendation.execution?.mode || "single_conversation";
  if (mode === "single_conversation") return "CTD route: keep this task in the current conversation.";
  if (mode === "subagent_parallel") return "CTD route: this task is a good fit for Codex native subagents when the current environment exposes them.";
  if (mode === "visible_worker_threads") return "CTD route: this task may need persistent visible workers. Confirm thread tools and user approval before creating or dispatching.";
  return "CTD route: use manual TaskCards, ShortReports, or Handoffs because required capabilities are missing or the project is not ready.";
}

if (process.env.NODE_ENV !== "test") {
  main();
}
