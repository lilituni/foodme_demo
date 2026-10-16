#!/usr/bin/env node
// Builds the test catalog: every JUnit class and Playwright spec with its tests and
// what it touches (endpoints, pages, backend classes). The selector skill and the
// selection-judge read it instead of opening every test file.
//
//   node agentic-workflows/selective-testing/scripts/build_catalog.mjs [--out .selection]
//   -> <out>/test-catalog.json
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { ROOT, parseArgs, outDir, writeJson } from "./lib.mjs";

const SOURCES = {
  junit: "apps/backend/src/test/java",
  web: "apps/web/e2e",
  admin: "apps/admin/e2e",
};

function listFiles(dir, pattern) {
  return readdirSync(join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => pattern.test(f))
    .map((f) => join(dir, f).replace(/\\/g, "/"));
}

const uniq = (xs) => [...new Set(xs)].sort();

function junitEntry(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const pkg = (src.match(/^package\s+([\w.]+);/m) || [])[1] || "";
  const cls = basename(file, ".java");
  const tests = [];
  const re = /@(Test|ParameterizedTest|RepeatedTest)\b[\s\S]*?void\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    const display = [...before.matchAll(/@DisplayName\("([^"]+)"\)/g)].pop();
    tests.push(display ? `${m[2]} (${display[1]})` : m[2]);
  }
  const mainClasses = uniq(
    [...src.matchAll(/import\s+am\.foodme\.backend\.([\w.]+);/g)].map((x) => x[1].split(".").pop()),
  );
  return {
    suite: "junit",
    id: cls,
    fqn: pkg ? `${pkg}.${cls}` : cls,
    file,
    tests,
    count: tests.length,
    endpoints: uniq([...src.matchAll(/"(\/api\/[^"?]*)/g)].map((x) => x[1])),
    backendClasses: mainClasses,
  };
}

function specEntry(suite, file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const describes = [...src.matchAll(/test\.describe\(\s*[`"']([^`"']+)[`"']/g)].map((x) => x[1]);
  const tests = [...src.matchAll(/\btest(?:\.only|\.skip|\.fixme)?\(\s*[`"']([^`"']+)[`"']/g)].map((x) => x[1]);
  // Specs that loop over viewports run every test once per viewport.
  const viewportLoop = /for\s*\(\s*const\s+\w+\s+of\s+\w*(viewports|VIEWPORTS|vps)\w*/i.test(src) || /\$\{vp\.name\}/.test(src);
  return {
    suite,
    id: basename(file),
    file,
    describes,
    tests,
    count: tests.length,
    perViewport: viewportLoop,
    pages: uniq([...src.matchAll(/goto\(\s*([^)]+)\)/g)].map((x) => x[1].trim())),
    endpoints: uniq([...src.matchAll(/(\/api\/[\w/-]+)/g)].map((x) => x[1])),
    helpers: uniq([...src.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((x) => x[1])),
    flaky: basename(file).startsWith("flake-"),
  };
}

const args = parseArgs(process.argv.slice(2));
const entries = [
  ...listFiles(SOURCES.junit, /Test\.java$/).map(junitEntry),
  ...listFiles(SOURCES.web, /\.spec\.ts$/).map((f) => specEntry("web", f)),
  ...listFiles(SOURCES.admin, /\.spec\.ts$/).map((f) => specEntry("admin", f)),
];

const totals = {};
for (const e of entries) {
  totals[e.suite] ??= { files: 0, tests: 0 };
  totals[e.suite].files++;
  totals[e.suite].tests += e.count;
}

const out = join(outDir(args), "test-catalog.json");
writeJson(out, { generatedAt: new Date().toISOString(), totals, entries });
console.log(`catalog: ${relative(ROOT, out)} -`, Object.entries(totals).map(([s, t]) => `${s} ${t.files} files/${t.tests} tests`).join(", "));
