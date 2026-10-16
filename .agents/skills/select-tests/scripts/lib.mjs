// Shared helpers for the Selection Based Testing scripts (Node 20+, no dependencies).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const MAP_PATH = resolve(ROOT, ".agents/skills/select-tests/test-map.json");
export const SUITES = ["junit", "web", "admin"];

export function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** Files changed between base and head (merge-base diff, like a PR): [{ path, status }], status A/M/D. */
export function changedFiles(base, head) {
  const out = git("diff", "--name-status", "--no-renames", `${base}...${head}`);
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [status, path] = line.split("\t");
    return { path, status: status[0] };
  });
}

/** A rule applies when one of its globs matches and its optional status filter allows the change (e.g. "statusNot": "A"). */
export function ruleApplies(rule, path, status) {
  if (rule.status && rule.status !== status) return false;
  if (rule.statusNot && rule.statusNot === status) return false;
  return matchesAny(path, rule.glob);
}

/** Minimal glob -> RegExp: ** (any path), * (any chars but /), ? , {a,b}. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += "(?:" + glob.slice(i + 1, end).split(",").map(escape).map((p) => p.replace(/\\\*/g, "[^/]*")).join("|") + ")";
      i = end;
    } else re += escape(c);
  }
  return new RegExp("^" + re + "$");
}
const escape = (s) => s.replace(/[.+^$()|[\]\\*]/g, "\\$&");

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function loadMap() {
  return readJson(MAP_PATH);
}

/** Parse `--key value` / `--flag` arguments into an object. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

export function outDir(args) {
  return resolve(ROOT, args.out || ".selection");
}

export function exists(p) {
  return existsSync(p);
}
