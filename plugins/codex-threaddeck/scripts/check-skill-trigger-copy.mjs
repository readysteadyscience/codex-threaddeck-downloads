#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skillPath = path.join(root, "skills", "codex-thread-dispatch", "SKILL.md");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseFrontmatter(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) return {};
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return {};
  const frontmatter = trimmed.slice(3, end).trim();
  const fields = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

if (!fs.existsSync(skillPath)) {
  fail(`missing CTD skill: ${path.relative(root, skillPath)}`);
}

const text = fs.readFileSync(skillPath, "utf8");
const frontmatter = parseFrontmatter(text);
const description = frontmatter.description || "";
const checks = [
  {
    name: "normal_prompt_default",
    ok: /\b(normal|ordinary|default)\b|普通|默认/i.test(description),
    help: "description must tell Codex the skill applies to normal/ordinary/default user prompts",
  },
  {
    name: "installed_or_project_state",
    ok: /installed|project|AGENTS\.md|\.threaddeck|ThreadDeck|CTD|项目/i.test(description),
    help: "description must mention installed CTD or project markers such as AGENTS.md/.threaddeck",
  },
  {
    name: "routing_surface",
    ok: /routing|route|intent|dispatch|task card|handoff|subagent|路由|调度|派发/i.test(description),
    help: "description must mention CTD routing/dispatch/subagent/task-card surfaces",
  },
  {
    name: "body_default_intent_compiler",
    ok: /Default Intent Compiler|ordinary user prompts as CTD-routable|普通.*CTD/i.test(text),
    help: "skill body must preserve the Default Intent Compiler rule",
  },
];

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error("CTD skill trigger copy is too narrow:");
  console.error(`description: ${description || "(missing)"}`);
  for (const check of failed) {
    console.error(`- ${check.name}: ${check.help}`);
  }
  process.exit(1);
}

console.log("ctd skill trigger copy check ok");
