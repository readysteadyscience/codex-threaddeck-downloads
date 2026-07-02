#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { makeId, nowIso, parseArgs, readJson, readText, redactSensitive, resolveCtdHistoryProjectDir, resolveCtdHome, slugify, trimForState, writeJson, writeText } from "./ctd-lib.mjs";

const args = parseArgs(process.argv.slice(2));

function ctdHome() {
  return resolveCtdHome(args);
}

function projectId() {
  return slugify(args.project || args.root || process.cwd());
}

function projectDir() {
  return resolveCtdHistoryProjectDir({ ...args, project: projectId() });
}

function indexPath() {
  return path.join(projectDir(), "thread-index.json");
}

function snapshotsDir() {
  return path.join(projectDir(), "snapshots");
}

function readIndex() {
  if (!fs.existsSync(indexPath())) {
    return {
      schemaVersion: "ctd.history_index.v1",
      project: args.project || projectId(),
      projectRoot: args.root || "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      records: [],
    };
  }
  return readJson(indexPath());
}

function writeIndex(index) {
  fs.mkdirSync(projectDir(), { recursive: true });
  index.updatedAt = nowIso();
  writeJson(indexPath(), index);
}

function ensureIndex() {
  const index = readIndex();
  writeIndex(index);
  return { home: ctdHome(), projectDir: projectDir(), indexPath: indexPath(), index };
}

function recordHistory() {
  const index = readIndex();
  const recordId = args.id || makeId("history", args.threadTitle || args.threadId || args.handoffId || "thread");
  const snapshot = importSnapshot(recordId);
  const record = redactSensitive({
    id: recordId,
    recordedAt: nowIso(),
    threadId: args.threadId || args["thread-id"] || "",
    threadTitle: args.threadTitle || args["thread-title"] || "",
    role: args.role || "",
    status: args.status || "history_reference",
    handoffId: args.handoffId || args["handoff-id"] || "",
    handoffPath: args.handoffPath || args["handoff-path"] || "",
    replacementThreadId: args.replacementThreadId || args["replacement-thread-id"] || "",
    replacementThreadTitle: args.replacementThreadTitle || args["replacement-thread-title"] || "",
    historyReference: args.historyReference || args["history-reference"] || args.threadId || args["thread-id"] || "",
    historyPreserved: args.historyPreserved !== "false" && args.history_preserved !== "false",
    focusPolicy: args.focusPolicy || args["focus-policy"] || "read_only_retrieval_on_demand",
    snapshotKind: snapshot?.snapshotKind || "",
    snapshotBytes: snapshot?.snapshotBytes || 0,
    note: args.note || "",
  });
  record.snapshotPath = snapshot?.snapshotPath || args.snapshotPath || args["snapshot-path"] || "";
  index.records = Array.isArray(index.records) ? index.records : [];
  index.records.push(record);
  writeIndex(index);
  return { home: ctdHome(), projectDir: projectDir(), indexPath: indexPath(), record };
}

function importSnapshot(recordId) {
  const file = args.importFile || args["import-file"] || args.snapshotFile || args["snapshot-file"];
  if (!file) return null;
  const maxBytes = Number(args.maxBytes || args["max-bytes"] || 1024 * 1024 * 2);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`history snapshot source is not a file: ${file}`);
  if (stat.size > maxBytes) throw new Error(`history snapshot source exceeds max bytes (${stat.size} > ${maxBytes}): ${file}`);
  const ext = path.extname(file) || ".txt";
  const snapshotFile = path.join(snapshotsDir(), `${slugify(recordId)}${ext}`);
  const text = redactSensitive(readText(file));
  fs.mkdirSync(snapshotsDir(), { recursive: true });
  writeText(snapshotFile, `${text}\n`);
  return {
    snapshotPath: snapshotFile,
    snapshotKind: "redacted_text_snapshot",
    snapshotBytes: Buffer.byteLength(text, "utf8"),
  };
}

function snippet(text, query, width = 220) {
  const haystack = String(text || "");
  const q = String(query || "").toLowerCase();
  const index = q ? haystack.toLowerCase().indexOf(q) : 0;
  if (index === -1) return trimForState(haystack, width);
  const start = Math.max(0, index - Math.floor(width / 3));
  const end = Math.min(haystack.length, index + Math.floor((width * 2) / 3));
  return trimForState(`${start > 0 ? "..." : ""}${haystack.slice(start, end)}${end < haystack.length ? "..." : ""}`, width);
}

function findRecords(query) {
  const index = readIndex();
  const q = String(query || "").toLowerCase();
  const records = [];
  for (const record of index.records || []) {
    const recordText = JSON.stringify(record).toLowerCase();
    let matched = !q || recordText.includes(q);
    let matchSnippet = "";
    if (record.snapshotPath && fs.existsSync(record.snapshotPath)) {
      const text = readText(record.snapshotPath);
      if (!matched && text.toLowerCase().includes(q)) matched = true;
      if (matched) matchSnippet = snippet(text, q);
    }
    if (matched) {
      records.push(redactSensitive({
        ...record,
        snippet: matchSnippet,
      }));
    }
  }
  return { home: ctdHome(), projectDir: projectDir(), indexPath: indexPath(), query: q, records };
}

function renderText(value) {
  const lines = [
    `CTD Home: ${value.home || ctdHome()}`,
    `Project history dir: ${value.projectDir || projectDir()}`,
    `Index: ${value.indexPath || indexPath()}`,
  ];
if (value.record) {
    lines.push(`Recorded: ${value.record.threadTitle || value.record.threadId || value.record.id}`);
    lines.push(`Focus policy: ${value.record.focusPolicy}`);
  }
  if (value.index) {
    lines.push(`Records: ${value.index.records?.length || 0}`);
  }
  if (Array.isArray(value.records)) {
    lines.push(`Matches: ${value.records.length}`);
  }
  return `${lines.join("\n")}\n`;
}

let output;
if (args.find || args.search) {
  output = findRecords(args.find || args.search);
} else if (args.record) {
  output = recordHistory();
} else if (args.ensure) {
  output = ensureIndex();
} else {
  const index = readIndex();
  output = { home: ctdHome(), projectDir: projectDir(), indexPath: indexPath(), index };
}

if (args.format === "json") {
  writeText(args.output, `${JSON.stringify(redactSensitive(output), null, 2)}\n`);
} else {
  writeText(args.output, renderText(output));
}
