#!/usr/bin/env node
// Offline benchmark: replay already-merged PRs through the rule selector, without running any test.
//
// For each PR we hide its own test changes from the selector (--blind-to-tests) and ask: would the
// rules alone have picked the tests the developer wrote/changed for that PR? Those tests are the
// best cheap "ground truth" of what the change affects.
//
//   node .agents/skills/select-tests/scripts/benchmark.mjs [--prs "5f47a4b 2752fdd"] [--out .selection/benchmark]
//   (default: every merged PR on main whose branch name contains "feature/")
//   -> <out>/benchmark.json + benchmark.md
//
// Optionally add --with-agent <dir> later: a folder of selection.json files produced by the
// select-tests skill for the same PRs, to compare "rules only" vs "rules + agent + judge".
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SUITES, git, outDir, parseArgs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const OUT = outDir({ out: args.out || ".selection/benchmark" });
mkdirSync(OUT, { recursive: true });
const here = ".agents/skills/select-tests/scripts";

execFileSync("node", [`${here}/build_catalog.mjs`, "--out", OUT], { cwd: ROOT, stdio: "inherit" });
const catalog = readJson(join(OUT, "test-catalog.json"));
const testsOf = (suite, id) => catalog.entries.find((e) => e.suite === suite && e.id === id)?.count ?? 0;
const totalTests = catalog.entries.reduce((n, e) => n + e.count, 0);

const prs = args.prs
  ? String(args.prs).split(/\s+/)
  : git("log", "--merges", "--first-parent", "main", "--format=%h %s")
      .split("\n")
      .filter((l) => /from \S+\/feature\//.test(l))
      .map((l) => l.split(" ")[0]);

const rows = [];
for (const sha of prs) {
  const title = git("log", "-1", "--format=%s", sha).replace(/^Merge pull request /, "");
  const prDir = join(OUT, sha);
  mkdirSync(prDir, { recursive: true });
  copyFileSync(join(OUT, "test-catalog.json"), join(prDir, "test-catalog.json"));
  execFileSync("node", [`${here}/select.mjs`, "rules", "--base", `${sha}^1`, "--head", `${sha}^2`, "--out", prDir, "--blind-to-tests"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("node", [`${here}/select.mjs`, "finalize", "--out", prDir], { cwd: ROOT, stdio: "pipe" });
  const sel = readJson(join(prDir, "selection.json"));
  const picked = (t) => sel.runAll || sel.selected.some((s) => s.suite === t.suite && s.id === t.id);
  const expected = sel.expected || [];
  const caught = expected.filter(picked);
  const selectedTests = sel.runAll ? totalTests : sel.selected.reduce((n, s) => n + testsOf(s.suite, s.id), 0);
  rows.push({
    pr: title,
    sha,
    runAll: sel.runAll,
    runAllReasons: sel.runAllReasons,
    expected: expected.map((t) => `${t.suite}:${t.id}`),
    missed: expected.filter((t) => !picked(t)).map((t) => `${t.suite}:${t.id}`),
    recall: expected.length ? caught.length / expected.length : null,
    selectedTests,
    totalTests,
    reduction: 1 - selectedTests / totalTests,
  });
}

writeJson(join(OUT, "benchmark.json"), { generatedAt: new Date().toISOString(), suites: SUITES, rows });
const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const md = [
  "# Selection benchmark (rules only, PR's own tests hidden)",
  "",
  "| PR | Run all? | Recall (PR's own tests picked) | Missed | Selected | Skipped |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.pr} | ${r.runAll ? "yes" : "no"} | ${pct(r.recall)} | ${r.missed.join(", ") || "-"} | ${r.selectedTests}/${r.totalTests} | ${pct(r.reduction)} |`),
  "",
  "Recall < 100% means a test the developer had to touch for that change would NOT have been selected by the rules:",
  "fix test-map.json, or check that the select-tests skill/judge adds it.",
  "",
  "Note: replayed against today's test catalog, so a test added later than the PR can't be missed by it.",
].join("\n");
writeFileSync(join(OUT, "benchmark.md"), md + "\n");
console.log(md);
