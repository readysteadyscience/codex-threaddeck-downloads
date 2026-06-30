import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      args._.push(part);
      continue;
    }
    const eq = part.indexOf("=");
    if (eq !== -1) {
      args[part.slice(2, eq)] = part.slice(eq + 1);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function readText(file) {
  if (!file || file === "-") {
    return fs.readFileSync(0, "utf8");
  }
  return fs.readFileSync(file, "utf8");
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

export function writeText(file, text) {
  if (!file || file === "-") {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

export function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value || "ctd")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "ctd";
}

export function makeId(prefix, seed) {
  const stamp = nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${slugify(seed).slice(0, 24)}`;
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

const sensitiveKey = /(api[_-]?key|secret|token|cookie|password|passwd|credential|certificate|private[_-]?key|authorization|bearer|session)/i;
const sensitiveValuePatterns = [
  /\bAuthorization\s*[:=]\s*Bearer\s+\S+/gi,
  /\bBearer\s+\S+/gi,
  /\b(cookie|authorization)\s*[:=]\s*\S+(?:\s+\S+)*/gi,
  /\b(api[_-]?key|secret|token|password|passwd|credential|certificate|private[_-]?key|session)\s*[:=]\s*\S+/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

export function redactSensitive(value, key = "") {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactSensitive(childValue, childKey);
    }
    return out;
  }
  if (typeof value !== "string") return value;
  let output = value;
  for (const pattern of sensitiveValuePatterns) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function trimForState(value, max = 240) {
  const text = String(redactSensitive(value) || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if ((ch === "\"" || ch === "'") && line[i - 1] !== "\\") {
      quote = quote === ch ? null : quote || ch;
    }
    if (ch === "#" && !quote) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseSimpleYaml(text) {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => {
      const clean = stripComment(raw).replace(/\s+$/g, "");
      return {
        indent: clean.match(/^ */)[0].length,
        content: clean.trim(),
      };
    })
    .filter((line) => line.content);

  function parseBlock(index, indent) {
    if (index >= lines.length || lines[index].indent < indent) {
      return [{}, index];
    }

    if (lines[index].content.startsWith("- ")) {
      const arr = [];
      while (index < lines.length && lines[index].indent === indent && lines[index].content.startsWith("- ")) {
        const itemText = lines[index].content.slice(2).trim();
        index += 1;
        if (!itemText) {
          const [child, next] = parseBlock(index, indent + 2);
          arr.push(child);
          index = next;
          continue;
        }
        const keyMatch = itemText.match(/^([^:]+):(.*)$/);
        if (keyMatch) {
          const obj = {};
          const key = keyMatch[1].trim();
          const rest = keyMatch[2].trim();
          if (rest) obj[key] = parseScalar(rest);
          else {
            const [child, next] = parseBlock(index, indent + 2);
            obj[key] = child;
            index = next;
          }
          while (index < lines.length && lines[index].indent > indent) {
            const [child, next] = parseBlock(index, indent + 2);
            Object.assign(obj, child);
            index = next;
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(itemText));
        }
      }
      return [arr, index];
    }

    const obj = {};
    while (index < lines.length && lines[index].indent === indent && !lines[index].content.startsWith("- ")) {
      const match = lines[index].content.match(/^([^:]+):(.*)$/);
      if (!match) {
        throw new Error(`Unsupported YAML line: ${lines[index].content}`);
      }
      const key = match[1].trim();
      const rest = match[2].trim();
      index += 1;
      if (rest) {
        obj[key] = parseScalar(rest);
      } else {
        const [child, next] = parseBlock(index, indent + 2);
        obj[key] = child;
        index = next;
      }
    }
    return [obj, index];
  }

  const [doc] = parseBlock(0, 0);
  return doc;
}
