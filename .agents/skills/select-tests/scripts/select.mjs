#!/usr/bin/env node
// Selection Based Testing - the selection file and everything that edits it.
// Every command reads/writes <out>/selection.json (default out: .selection).
//
//   rules       --base <ref> --head <ref>      baseline from test-map.json (needs test-catalog.json)
//   add         --suite junit|web|admin --id <test> --reason "<why>" [--source agent|judge]
//   apply-judge --verdict <judge-N.json>       add every test the judge listed as missing
//   resolve-trace --path <file> --note "<what was found>"   close an open trace (add its tests first)
//   finalize                                   every still-open trace gets its rule's fallback
//   run-all     --reason "<why>"               fall back to the whole suite
//   strip                                      judge-input.json: the selection without any reasons
//   report                                     selection-report.md (the PR comment)
//   commands                                   what CI runs (also written to $GITHUB_OUTPUT)
//
// Tests are only ever added, never removed: the agents can widen the rule baseline, not shrink it.
import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES, changedFiles, exists, git, loadMap, outDir, parseArgs, readJson, ruleApplies, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const OUT = outDir(args);
const SEL = join(OUT, "selection.json");
const catalog = readJson(join(OUT, "test-catalog.json"));
const byKey = new Map(catalog.entries.map((e) => [`${e.suite}:${e.id}`, e]));
const byFile = new Map(catalog.entries.map((e) => [e.file, e]));

function emptySelection(base, head) {
  return { base, head, generatedAt: new Date().toISOString(), runAll: false, runAllReasons: [], changedFiles: [], traces: [], selected: [] };
}

function addTest(sel, suite, id, source, reason) {
  const ids = id === "*" ? catalog.entries.filter((e) => e.suite === suite).map((e) => e.id) : [id];
  for (const one of ids) {
    if (!byKey.has(`${suite}:${one}`)) throw new Error(`unknown test ${suite}:${one} - check test-catalog.json`);
    let entry = sel.selected.find((s) => s.suite === suite && s.id === one);
    if (!entry) sel.selected.push((entry = { suite, id: one, sources: [], reasons: [] }));
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (reason && !entry.reasons.includes(reason)) entry.reasons.push(reason);
  }
}

function setRunAll(sel, reason) {
  sel.runAll = true;
  if (!sel.runAllReasons.includes(reason)) sel.runAllReasons.push(reason);
}

function rules() {
  if (!args.base || !args.head) throw new Error("rules needs --base and --head");
  const map = loadMap();
  const sel = emptySelection(git("rev-parse", args.base), git("rev-parse", args.head));
  for (const { path, status } of changedFiles(args.base, args.head)) {
    const row = { path, status, outcome: "", matched: [] };
    sel.changedFiles.push(row);

    const ownTest = byFile.get(path);
    if (ownTest) {
      row.outcome = "changed-test";
      // --blind-to-tests (benchmark): pretend we can't see the PR's own tests, record them as what should be picked.
      if (args["blind-to-tests"]) (sel.expected ??= []).push({ suite: ownTest.suite, id: ownTest.id });
      else addTest(sel, ownTest.suite, ownTest.id, "changed-test", `the PR changes this test (${path})`);
      continue;
    }
    if (/^apps\/(web|admin)\/e2e\/.*\.spec\.ts$/.test(path) || /^apps\/backend\/src\/test\/.*Test\.java$/.test(path)) {
      row.outcome = "deleted-test";
      continue;
    }
    const all = map.runAll.find((r) => ruleApplies(r, path, status));
    if (all) {
      row.outcome = "run-all";
      row.matched.push(all.id);
      setRunAll(sel, `${path} -> ${all.id}: ${all.why}`);
      continue;
    }
    const ign = map.ignore.find((r) => ruleApplies(r, path, status));
    if (ign) {
      row.outcome = "ignored";
      row.matched.push(ign.id);
      continue;
    }
    const hits = map.rules.filter((r) => ruleApplies(r, path, status));
    if (hits.length === 0) {
      row.outcome = "unmapped";
      setRunAll(sel, `${path} matches no rule in test-map.json (unknown impact -> run everything)`);
      continue;
    }
    row.outcome = "rule";
    for (const r of hits) {
      row.matched.push(r.id);
      if (r.trace) {
        sel.traces.push({ path, rule: r.id, why: r.why, fallback: r.trace.fallback, status: "open", note: "" });
        continue;
      }
      for (const suite of SUITES) for (const id of r[suite] || []) addTest(sel, suite, id, "rule", `${r.id}: ${path}`);
    }
  }
  return sel;
}

function totals(sel) {
  const t = {};
  for (const suite of SUITES) {
    const all = catalog.entries.filter((e) => e.suite === suite);
    const chosen = sel.runAll ? all : all.filter((e) => sel.selected.some((s) => s.suite === suite && s.id === e.id));
    t[suite] = {
      files: chosen.length,
      filesTotal: all.length,
      tests: chosen.reduce((n, e) => n + e.count, 0),
      testsTotal: all.reduce((n, e) => n + e.count, 0),
    };
  }
  return t;
}

function judgeFiles() {
  return exists(OUT) ? readdirSync(OUT).filter((f) => /^judge-\d+\.json$/.test(f)).sort() : [];
}

function report(sel) {
  const t = totals(sel);
  const sum = (k) => SUITES.reduce((n, s) => n + t[s][k], 0);
  const pct = sum("testsTotal") ? Math.round((100 * sum("tests")) / sum("testsTotal")) : 0;
  const lines = ["## 🎯 Selection Based Testing", ""];
  if (sel.runAll) {
    lines.push("**Running the whole suite**, because:", "", ...sel.runAllReasons.map((r) => `- ${r}`), "");
  } else {
    lines.push(`Selected **${sum("tests")} of ${sum("testsTotal")} tests (${pct}%)** - ${100 - pct}% skipped on this PR.`, "");
  }
  lines.push("| Suite | Files | Tests |", "|---|---|---|");
  for (const s of SUITES) lines.push(`| ${s} | ${t[s].files}/${t[s].filesTotal} | ${t[s].tests}/${t[s].testsTotal} |`);
  lines.push("");

  if (!sel.runAll && sel.selected.length) {
    lines.push("<details><summary>Selected tests and why</summary>", "", "| Suite | Test | Added by | Why |", "|---|---|---|---|");
    for (const s of [...sel.selected].sort((a, b) => (a.suite + a.id).localeCompare(b.suite + b.id)))
      lines.push(`| ${s.suite} | \`${s.id}\` | ${s.sources.join(", ")} | ${s.reasons.map((r) => r.replace(/\|/g, "\\|")).join("<br>")} |`);
    lines.push("", "</details>", "");
  }

  if (sel.traces.length) {
    lines.push("**Shared files traced by the agent**", "", "| File | Result | Note |", "|---|---|---|");
    for (const t of sel.traces) {
      const note = t.note || (t.status === "fallback" ? "not traced - fallback applied" : "");
      lines.push(`| \`${t.path}\` | ${t.status} | ${note.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  lines.push("<details><summary>Changed files</summary>", "", "| File | Change | Outcome | Rule |", "|---|---|---|---|");
  for (const f of sel.changedFiles) lines.push(`| \`${f.path}\` | ${f.status} | ${f.outcome} | ${f.matched.join(", ")} |`);
  lines.push("", "</details>", "");

  const judges = judgeFiles();
  if (judges.length) {
    lines.push("### ⚖️ Selection judge");
    for (const f of judges) {
      const v = readJson(join(OUT, f));
      lines.push("", `**${f.replace(".json", "")}: ${v.verdict}** - ${(v.missing || []).length} missing, ${(v.unnecessary || []).length} unnecessary`);
      for (const m of v.missing || []) lines.push(`- missing \`${m.suite}:${m.id}\` - ${m.reason}`);
      for (const u of v.unnecessary || []) lines.push(`- unnecessary \`${u.suite}:${u.id}\` - ${u.reason} _(advisory, kept)_`);
    }
    lines.push("");
  } else if (!sel.runAll) {
    const agentWorked = sel.traces.some((t) => t.status === "traced") || sel.selected.some((s) => s.sources.includes("agent"));
    lines.push(agentWorked
      ? "_No judge verdict - the agent's selection above was not checked by the judge._"
      : "_No judge verdict - rule baseline with its safe fallbacks only._", "");
  }
  lines.push(`<sub>base ${sel.base.slice(0, 7)} → head ${sel.head.slice(0, 7)} · the post-merge full run on main checks this selection for misses</sub>`);
  lines.push(`<!-- selection: ${JSON.stringify({ runAll: sel.runAll, tests: sum("tests"), total: sum("testsTotal") })} -->`);
  return lines.join("\n") + "\n";
}

function commands(sel) {
  if (!sel.finalized) throw new Error("run `select.mjs finalize` first");
  const pick = (suite) =>
    sel.runAll ? [] : sel.selected.filter((s) => s.suite === suite).map((s) => byKey.get(`${suite}:${s.id}`));
  const junit = pick("junit").map((e) => `--tests ${e.fqn}`).join(" ");
  const web = pick("web").map((e) => e.file.replace(/^apps\/web\//, "")).join(" ");
  const admin = pick("admin").map((e) => e.file.replace(/^apps\/admin\//, "")).join(" ");
  const out = {
    run_all: String(sel.runAll),
    run_junit: String(sel.runAll || junit.length > 0),
    run_web: String(sel.runAll || web.length > 0),
    run_admin: String(sel.runAll || admin.length > 0),
    junit_args: junit,
    web_specs: web,
    admin_specs: admin,
  };
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return out;
}

const load = () => readJson(SEL);
switch (cmd) {
  case "rules": {
    const sel = rules();
    writeJson(SEL, sel);
    const t = totals(sel);
    console.log(sel.runAll ? `RUN ALL: ${sel.runAllReasons.join(" | ")}` : `baseline: ${SUITES.map((s) => `${s} ${t[s].tests}/${t[s].testsTotal}`).join(", ")}`);
    break;
  }
  case "add": {
    const sel = load();
    if (!args.reason) throw new Error("add needs --reason");
    addTest(sel, args.suite, args.id, args.source || "agent", args.reason);
    writeJson(SEL, sel);
    console.log(`added ${args.suite}:${args.id}`);
    break;
  }
  case "apply-judge": {
    const sel = load();
    const v = readJson(args.verdict);
    for (const m of v.missing || []) addTest(sel, m.suite, m.id, "judge", `judge: ${m.reason}`);
    if (v.runAll) setRunAll(sel, `judge: ${v.runAll}`);
    writeJson(SEL, sel);
    console.log(`applied ${(v.missing || []).length} missing test(s) from ${args.verdict}`);
    break;
  }
  case "resolve-trace": {
    const sel = load();
    const open = sel.traces.filter((x) => x.path === args.path && x.status === "open");
    if (!open.length) throw new Error(`no open trace for ${args.path}`);
    if (!args.note) throw new Error("resolve-trace needs --note");
    for (const x of open) Object.assign(x, { status: "traced", note: args.note });
    writeJson(SEL, sel);
    console.log(`traced ${args.path}`);
    break;
  }
  case "finalize": {
    const sel = load();
    for (const x of sel.traces.filter((t) => t.status === "open")) {
      for (const suite of SUITES)
        for (const id of x.fallback[suite] || []) addTest(sel, suite, id, "fallback", `${x.rule}: ${x.path} was not traced`);
      x.status = "fallback";
    }
    sel.finalized = true;
    writeJson(SEL, sel);
    console.log(`finalized (${sel.traces.filter((t) => t.status === "fallback").length} fallback(s))`);
    break;
  }
  case "run-all": {
    const sel = load();
    setRunAll(sel, args.reason || "requested");
    writeJson(SEL, sel);
    break;
  }
  case "strip": {
    const sel = load();
    const input = {
      base: sel.base,
      head: sel.head,
      runAll: sel.runAll,
      changedFiles: sel.changedFiles.map((f) => f.path),
      selected: Object.fromEntries(SUITES.map((s) => [s, sel.selected.filter((x) => x.suite === s).map((x) => x.id).sort()])),
    };
    writeJson(join(OUT, "judge-input.json"), input);
    console.log(`judge input: ${join(OUT, "judge-input.json")}`);
    break;
  }
  case "report": {
    const md = report(load());
    writeFileSync(join(OUT, "selection-report.md"), md);
    console.log(md);
    break;
  }
  case "commands":
    console.log(JSON.stringify(commands(load()), null, 2));
    break;
  default:
    console.error("usage: select.mjs rules|add|apply-judge|run-all|strip|report|commands [--out dir] ...");
    process.exit(2);
}
