#!/usr/bin/env node
// Post-merge evaluation: compare a PR's selection with the FULL suite that ran on main after the merge.
// No extra test run - the full run on main happens anyway (ci.yml, push to main).
//
//   node agentic-workflows/selective-testing/scripts/evaluate.mjs \
//     --selection <dir with selection.json [+ judge-N.json]> \
//     [--junit-dir <dir of TEST-*.xml>] [--web-json <playwright json>] [--admin-json <playwright json>] \
//     [--out <dir>]                       -> <out>/evaluation.json + evaluation.md
//
// A "miss" = a test that FAILED in the full run but was NOT selected on the PR.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT, exists, parseArgs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const selDir = resolve(ROOT, args.selection || ".selection");
const OUT = resolve(ROOT, args.out || selDir);
const sel = readJson(join(selDir, "selection.json"));
const judges = readdirSync(selDir).filter((f) => /^judge-\d+\.json$/.test(f)).map((f) => readJson(join(selDir, f)));
const judgeFlagged = new Set(judges.flatMap((j) => (j.missing || []).map((m) => `${m.suite}:${m.id}`)));

const results = []; // { suite, id, test, outcome: passed|failed|flaky|skipped }

if (args["junit-dir"] && exists(resolve(ROOT, args["junit-dir"]))) {
  const dir = resolve(ROOT, args["junit-dir"]);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".xml"))) {
    const xml = readFileSync(join(dir, f), "utf8");
    for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const attr = (k) => (m[1].match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || "";
      const body = m[3] || "";
      const outcome = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
      results.push({ suite: "junit", id: attr("classname").split(".").pop(), test: attr("name"), outcome });
    }
  }
}

function readPlaywright(suite, file) {
  if (!file || !exists(resolve(ROOT, file))) return;
  const report = readJson(resolve(ROOT, file));
  const walk = (s) => {
    for (const spec of s.specs || [])
      for (const t of spec.tests || []) {
        const outcome = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.status] || t.status;
        results.push({ suite, id: basename(spec.file || s.file), test: spec.title, outcome });
      }
    for (const child of s.suites || []) walk(child);
  };
  for (const s of report.suites || []) walk(s);
}
readPlaywright("web", args["web-json"]);
readPlaywright("admin", args["admin-json"]);

const selected = (r) => sel.runAll || sel.selected.some((s) => s.suite === r.suite && s.id === r.id);
const ran = results.filter((r) => r.outcome !== "skipped");
const failed = ran.filter((r) => r.outcome === "failed");
const misses = failed.filter((r) => !selected(r));
const caught = failed.filter(selected);
const evaluation = {
  base: sel.base,
  head: sel.head,
  runAll: sel.runAll,
  fullRun: { tests: ran.length, failed: failed.length, flaky: ran.filter((r) => r.outcome === "flaky").length },
  selectedOfFullRun: ran.filter(selected).length,
  reduction: ran.length ? 1 - ran.filter(selected).length / ran.length : null,
  recall: failed.length ? caught.length / failed.length : null,
  caught: caught.map((r) => `${r.suite}:${r.id} › ${r.test}`),
  misses: misses.map((r) => ({
    test: `${r.suite}:${r.id} › ${r.test}`,
    judgeFlagged: judgeFlagged.has(`${r.suite}:${r.id}`),
  })),
  judge: {
    rounds: judges.length,
    flagged: [...judgeFlagged],
    flaggedThatFailed: [...judgeFlagged].filter((k) => failed.some((r) => `${r.suite}:${r.id}` === k)),
  },
};

mkdirSync(OUT, { recursive: true });
writeJson(join(OUT, "evaluation.json"), evaluation);
const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const verdict = evaluation.misses.length ? "❌ selection MISSED failing tests" : failed.length ? "✅ every failure was selected" : "✅ full run green - nothing to miss";
const md = [
  "## 🔁 Post-merge check of the test selection",
  "",
  `**${verdict}**`,
  "",
  "| Metric | Value |",
  "|---|---|",
  `| Full run on main | ${ran.length} tests, ${failed.length} failed, ${evaluation.fullRun.flaky} flaky |`,
  `| Selected on the PR | ${sel.runAll ? "whole suite" : `${evaluation.selectedOfFullRun} tests`} (skipped ${pct(evaluation.reduction)}) |`,
  `| Recall (failures that were selected) | ${pct(evaluation.recall)} |`,
  `| Judge rounds / tests it added | ${judges.length} / ${judgeFlagged.size} |`,
  "",
  ...(misses.length
    ? ["**Misses** - add a rule to `test-map.json` (or explain why the judge didn't flag it):", "", ...evaluation.misses.map((m) => `- \`${m.test}\`${m.judgeFlagged ? " _(judge flagged it - check why it wasn't run)_" : ""}`), "",
       "_A failure can also be pre-existing or flaky - compare with the previous run on main before blaming the selector._"]
    : []),
].join("\n");
writeFileSync(join(OUT, "evaluation.md"), md + "\n");
console.log(md);
if (args["fail-on-miss"] && misses.length) process.exit(1);
