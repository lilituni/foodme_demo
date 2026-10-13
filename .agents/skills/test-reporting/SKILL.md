---
name: test-reporting
description: Step 10 of the functional-testing workflow (/test-reporting <T>) - write the test completion report for one feature run (runs/<T>/report.md + report.html - results per AC and case, defects, deviations, exit criteria, residual risks, the approval trail and a release recommendation), get the human's approval in chat, then (only if approved) publish the cases and a test run with results to Qase project FM and comment on the Jira story. ISTQB test completion.
---

# Step 10: Test completion report

Argument: `T`. Run dir `R = agentic-workflows/functional-testing/runs/<T>/`.
You write `R/report.md`, `R/report.html`, each case's `qase_id` in
`R/spec.yaml` (nothing else in it), and the `report` entry of `R/gates.yaml`
after the human approves. You **report**; you don't re-run, re-judge or
re-triage anything. A fact you can't find in a run file is "not recorded",
never a guess.

## Gate

`R/gates.yaml` has `triage.approved: true`. Otherwise:
`STATUS: BLOCKED: step 09 is not approved; run /bug-triage <T>`.

Resume: if `R/report.md` exists and `report.approved` is not set, go to
"Human review". If it's approved but `report.qase` says `pending`, go to "Publish".

## 1. Read

Everything in `R`: `spec.yaml` (ACs, questions + answers, cases with
`execution`, `automation`, `regression`), `plan.md` (scope, exit criteria),
`gates.yaml` (approvals and `reopened`), `verdicts/*`, `execution.md`,
`results.json`, `triage.json`. For each Jira key in `triage.json` actions,
get its current status (`getJiraIssue`, fields `summary,status,priority,labels`).

## 2. Write `R/report.md`

Set `R/status` to `▶10 · writing report`. Short, factual, numbers from the
files. Sections:

1. **Summary**: feature, branch, commit under test (`results.json`), dates
   (first and last gate), one paragraph of outcome, and the **recommendation**:
   `Ready to release`, `Ready with known bugs` or `Not ready`, with the reasons
   (open bugs by severity, unmet exit criteria). It's advice: the human decides.
2. **Scope and test basis**: ACs in scope, out of scope, the questions with
   their answers (one line each), Jira and doc sources.
3. **Results per AC** (traceability): `AC | cases | 05 manual | 08 automated | defects | verdict`,
   verdict = `covered, passing` / `covered, failing (<KEY>)` / `not covered`.
4. **Results per case**: `case | title | level | 05 result (confidence, human check) | automation (projects) | 08 result | defect`.
5. **Automated runs**: per suite from `results.json` (`passed / failed / flaky / skipped`,
   time), the regression failures outside the feature with their baseline
   (`known-failing` on main vs `new`) and what triage decided.
6. **Defects**: `key | summary | severity | priority | status (now) | found by (case / test / observation) | introduced by branch`,
   plus comments added to existing tickets, and findings decided `not a bug` / `environment` / `flaky` with the human's note.
7. **Deviations from the plan**: anything not run as planned - e.g. an
   unconfirmed unsure case, a case left manual-only, a suite not run, a
   precondition accepted as a failure instead of blocked, a test run
   in-process instead of against the SUT. Take them from gate notes, verdicts
   and `results.json`; don't invent.
8. **Exit criteria**: each criterion of `plan.md` section 7 → `met` / `not met` + the evidence.
9. **Residual risks**: what is untested or uncertain and why it matters
   (from the plan's risks, the deviations, open bugs).
10. **Approvals and history**: every `gates.yaml` entry (`step | by | at | note`),
    every `reopened` entry, and every judge verdict file with its verdict.
11. **Artifacts**: run files (paths), test files in the feature branch with
    commits (`tests.commit`, marker commit), Jira keys, Qase run (filled after publishing).

Never put passwords, tokens or test-account emails in the report.

## 3. Write `R/report.html`

The same content as one self-contained file: inline CSS only, no scripts or
external files, readable when opened from disk and printed. A header with
`T`, title, recommendation and the counts as tiles (cases, match/mismatch,
tests passed/failed, bugs filed); then the sections as tables. Status words get
a colour **and** the word (`✔ pass`, `✘ fail`, `⚠ known bug`) so it works in
print and for colour-blind readers. Light background, `@media print` hides nothing.

## 4. Human review (in chat)

Set `R/status` to `🧑10 · approve the report`. Show the summary with the
recommendation, the per-AC table, the defects table, the deviations, and the
paths `runs/<T>/report.md` and `report.html`. Say exactly what publishing will
do: in Qase project `FM`, a suite `<T> <title>`, the N cases (created or
updated), one run `<T> functional run @ <commit>` with N results, completed;
and a comment on Jira `<T>` with the summary and the Qase run link.

Ask with **AskUserQuestion**: `Approve and publish` / `Approve, don't publish` /
`Request changes` / `Stop here`.

- `Request changes`: apply the notes, show what changed, ask again.
- `Approve and publish` / `Approve, don't publish`: add the `report` entry to
  `R/gates.yaml` (keep the others): `{ approved: true, by: <git config user.name>, at: <date -u>, recommendation, qase: pending | skipped, note }`.
  Then "Publish" (or end).
- `Stop here`: `NEEDS_HUMAN`.

## 5. Publish (only after `Approve and publish`)

Set `R/status` to `▶10 · publishing to Qase`. Use the Qase MCP tools
(`mcp__qase__*`). If they aren't loaded in this session, stop:
`STATUS: NEEDS_HUMAN: the Qase MCP server isn't connected (.mcp.json → .agents/mcp.json, token in AgentSecrets); reconnect and re-run /test-reporting <T>`.
Check each tool's input schema before the first call (`qase_discover_tools`
or ToolSearch); don't guess field names.

1. `qase_project_context` for `FM`.
2. Suite: `qase_suite_upsert` titled `<T> <title>`.
3. Cases: one Qase case per run case - title `<case-id> <title>`, steps with
   `expected_result` from the case (word for word), preconditions,
   tags `[<T>, <case-id>, <AC ids>]`, `automation` automated / manual,
   description naming the test file and title. A case with `qase_id` is
   updated, not created again. Write each `qase_id` back into `spec.yaml`.
4. Run: `qase_run_upsert` titled `<T> functional run @ <commit>` with the
   cases, then one `qase_result_record` per case:
   - `passed`: 05 match and 08 passed;
   - `failed`: 08 failed, or 05 mismatch - comment with the failed fact and
     the Jira key (marked tests that now "pass" because of `test.fail` are
     still `failed` here: the behaviour is broken);
   - `blocked`: 05 blocked and not automated;
   - `skipped`: manual-only and not executed.
   Comment = the 05 and 08 results in one line, plus the defect key.
5. `qase_run_complete`, and attach `report.html` (`qase_attachment_upload`) if
   the tools allow it.
6. Jira: `addOrEditJiraIssueComment` on `<T>`: recommendation, counts, defect
   keys and the Qase run link.

Update the `report` gate: `qase: "<run url>"`, and the report's Artifacts
section (both files). A failed call: record `qase: failed (<error>)`, keep
what was created, and say so; don't retry in a loop.

## End

Set `R/status` to all `✅` with `done` (or `🧑10` / `⛔10` with the reason).

- `STATUS: DONE: report approved (<recommendation>); Qase run <url | not published>; Jira comment <added | skipped>`
- `STATUS: NEEDS_HUMAN: <what>`
- `STATUS: BLOCKED: <reason>`
