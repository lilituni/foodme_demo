---
name: bug-triage
description: Bug-triage workflow (/bug-triage <T>, or /bug-triage --ci <run-id> for a failing GitHub Actions run). Step 09 of the functional-testing workflow - collects every finding of a run (step 05 mismatches, failing / flaky / disagreeing tests from step 08, observations, inbox items), has the read-only triage-analyst subagent propose a cause and class for each, gets the human's decision per finding, then files the approved Jira bugs, marks known-bug tests and re-opens earlier steps - only after the human approves. Writes triage.json.
---

# Bug triage (step 09)

**Agents propose, the human decides.** Nothing goes to Jira, no test is
marked and no step is re-opened before the human approves it in chat.

Two ways in:

- `/bug-triage <T>` - a functional-testing run (called by the
  `feature-testing-pipeline` skill as step 09, or on its own).
  `R = agentic-workflows/functional-testing/runs/<T>/`.
- `/bug-triage --ci <run-id>` - a failing GitHub Actions run, outside any
  pipeline run. See "CI mode" at the end.

You write `R/triage.json`, `R/status`, the `triage` entry of `R/gates.yaml`
(only after the human approves), known-bug markers in the feature checkout
(only after the human approves), and item status in the inbox. You never
change a case, an expected value, the app's code or another step's file.

## Gate

`R/results.json` exists (step 08 done). Otherwise:
`STATUS: BLOCKED: step 08 has no results; run /run-regression <T>`.

Resume: if `R/triage.json` exists, keep every finding that has a `decision`,
and continue with the first one without. If all are decided but `actions` are
not all `done`, go to "Act".

## 1. Collect the findings

Set `R/status` to `▶09 · collecting findings`. `W` = the `git worktree list`
line showing `[<branch>]`. One finding per **cause you can see**, numbered `F-01`, `F-02`, …:

| Source | Becomes a finding when |
|---|---|
| `spec.yaml` case `execution` (05) | `mismatch` or `blocked`; its case tests in `results.json` join the same finding |
| `results.json` case tests | `agrees_with_05: false`, `flaky`, or `same_as_dry_run: false` (if not already in a finding above) |
| `results.json` feature / other tests | `failed` or `flaky` (`known-failing` ones too - they still need a ticket or a link) |
| `results.json` suites | `"status": "error"` |
| `execution.md` "Other observations" | a line that describes app behaviour the sources don't cover or contradict (skip bookkeeping such as "order created at …") |
| inbox `agentic-workflows/functional-testing/inbox.yaml` | an item with `status: open` and `run: <T>` or `run: any` |

Desktop and mobile results of one test, and a 05 mismatch and its test, are
one finding. Don't merge two different failures because they look alike -
the analyst says `same_cause_as`, the human decides.

Write them to `R/triage.json` (Write tool, whole file; see "triage.json") with
`sources` filled in and no `proposal` yet.

### The inbox

`agentic-workflows/functional-testing/inbox.yaml` (git-ignored, like the runs)
holds defects someone noticed outside a run - e.g. while implementing a
feature - so they get triaged instead of forgotten:

```yaml
items:
  - id: IN-01
    run: any                  # a T, or any (picked up by the next triage)
    status: open              # open | triaged (+ finding "<T>/F-nn")
    noted_by: "<who>"
    noted_at: "<date -u>"
    text: "<what was seen, where, how to reproduce>"
```

## 2. Analyse (triage-analyst subagent)

Set `R/status` to `▶09 · analysing F-nn of N`. For each finding run the
`triage-analyst` subagent (Agent tool, `subagent_type: triage-analyst`) with
the prompt:

```
Triage this finding. R: <R>  W: <W>
<the finding's JSON from triage.json>
```

Up to 4 analysts may run at once (one message, several Agent calls); each one
gets a single finding. Save each one's final fenced JSON block **word for word**
as that finding's `proposal`. Don't edit or second-guess it; disagreements are
for the human.

## 3. Duplicates (Jira)

For every `product-bug`, `flaky` or `known` proposal, search Jira (cloudId and
project in the pipeline skill) before anyone files anything, with each of its
`jira_search` terms:
`project = KAN AND labels = bug AND text ~ "<term>"`. Record matches (key,
summary, status) in the finding's `jira_matches`. A clear match turns the
suggested action into "comment on <KEY>", never a second ticket.

## 4. Human review: one decision per finding

Set `R/status` to `🧑09 · decide N findings`. Show:

- A table `F | sources | class (confidence) | summary | introduced by branch | Jira matches`.
- For each `product-bug` / `flaky`: its `draft` in full (summary, steps, expected, actual, evidence, severity, priority) and `root_cause`.
- `same_cause_as` groups, and every `obstacles` entry.

Ask with **AskUserQuestion**, one question per finding (up to 4 per call,
header = `F-nn`), the proposal first:

| Proposed class | Options |
|---|---|
| `product-bug` | `File bug (as drafted)` / `Comment on <KEY>` (when matched) / `Test is wrong (back to 06)` / `Not a bug` |
| `test-defect` | `Test is wrong (back to 06)` / `File bug` / `Not a bug` |
| `spec-gap` | `Spec gap (back to 01)` / `File bug` / `Test is wrong (back to 06)` |
| `environment` | `Environment (re-run 08)` / `File bug` / `Not a bug` |
| `flaky` | `File flaky ticket` / `Watch (no ticket)` / `File bug` |
| `known` | `Comment on <KEY>` / `File bug` / `Not a bug` |
| `not-a-bug` | `Not a bug` / `File bug` / `Spec gap (back to 01)` |

"Other" lets the human change severity, priority, wording or name an existing
key. Record each answer as the finding's `decision`
`{ class, action, by: <git config user.name>, at: <date -u>, note }`.
A changed draft is shown again before it's filed.

## 5. Approve the actions

Set `R/status` to `🧑09 · approve actions`. List everything that will happen,
one line each:

- `file` - a new KAN bug: its summary, severity, priority.
- `comment` - on `<KEY>`: the occurrence text.
- `mark` - in `W`, the failing **case tests** of each filed or known bug get a
  known-bug marker (below), then one commit on `branch` - not pushed.
- `re-open` - step 06 or 01, with the reason (several → only the earliest; it
  removes the later gates anyway).
- `re-run 08` - for `environment` findings, after the human fixes the cause.
- `inbox` - items set to `triaged`.

Ask with AskUserQuestion: `Approve and act` / `Change a decision` / `Stop here`.
`Change a decision` → back to 4 for the findings named. `Stop here` →
`NEEDS_HUMAN` (decisions stay in `triage.json`, nothing acted on).

## 6. Act (only after `Approve and act`)

Set `R/status` to `▶09 · acting`. Record each action in the finding's
`actions` as `{ type, status: done|failed, result, at }`.

- **file / comment**: follow the `report-jira-bug` skill with the approved
  draft (it searches again and comments instead of duplicating). Add the
  labels `stlc` and `<T>` (lower case) next to its own, and the line
  `Found by: functional-testing run <T>, finding F-nn (step 09)` in Evidence.
  The bug's Environment is the SUT and commit from `results.json`.
- **mark** (Playwright case tests only): as the test body's first line,
  `test.fail(true, "<KEY>: <bug summary>");` - the test then passes while the
  bug is there and goes red when it's fixed, which tells you to remove the
  marker. JUnit case tests have no such marker: they stay red and
  `triage.json` / the report list them as known bugs. Never mark the
  developer's own tests or tests of another feature. Then run only the marked
  tests once with step 08's web command and `-g "<case ids>"`; each must
  pass. Commit in `W` (`<T>: mark known bugs <keys> (step 09)`, the repo's
  attribution lines) and ask "Push `<branch>` now?" (`Push` / `Not now`).
- **re-open**: follow "Re-opening a step" in the pipeline skill - remove that
  step's gate and every later gate from `gates.yaml`, and add a `reopened`
  entry whose `reason` names the findings (`F-nn: <summary>`).
- **inbox**: set the item's `status: triaged` and `finding: "<T>/F-nn"`.

An action that fails (Jira down, marked test still red) stays `failed`; say
so - never retry by changing the decision.

## 7. Gate and end

If nothing was re-opened, add the `triage` entry to `R/gates.yaml` (keep the
others): `{ approved: true, by, at: <date -u>, note: "<N> findings: <b> bugs filed (<keys>), <c> comments, <m> tests marked, <k> not a bug" + the human's note }`.

Show the final table `F | decision | action | result (key / commit)`.

- `STATUS: DONE: N findings triaged (<b> bugs filed: <keys>); next /test-reporting <T> (step 10)`
- `STATUS: NEEDS_HUMAN: re-run /<step skill> <T> (step NN re-opened: <reason>)`
- `STATUS: NEEDS_HUMAN: fix the environment (<what>) and re-run /run-regression <T>`
- `STATUS: BLOCKED: <reason>`

## triage.json

```json
{
  "run": "KAN-11",
  "step": "09",
  "results_commit": "e740a39",
  "findings": [
    {
      "id": "F-01",
      "sources": [
        { "type": "execution", "case": "KAN-11-TC-04", "result": "mismatch", "failed_facts": ["…"] },
        { "type": "test", "suite": "web", "title": "KAN-11-TC-04 …", "project": "desktop", "status": "failed", "error": "…" }
      ],
      "proposal": { "...": "the analyst's JSON, word for word" },
      "jira_matches": [ { "key": "KAN-5", "summary": "…", "status": "To Do" } ],
      "decision": { "class": "product-bug", "action": "file", "by": "…", "at": "…", "note": "" },
      "actions": [ { "type": "file", "status": "done", "result": "KAN-21", "at": "…" } ]
    }
  ]
}
```

Source `type`: `execution` | `test` | `suite` | `observation` (with the
`execution.md` anchor and the line word for word) | `inbox` (with the item id).

## CI mode (`/bug-triage --ci <run-id>`)

For a failing GitHub Actions run of this repo, outside a pipeline run.
`R = agentic-workflows/bug-triage/ci-<run-id>/`, no `status` file, no gates.

1. `gh run view <run-id> --json headBranch,headSha,conclusion,jobs` and
   `gh run view <run-id> --log-failed` (read-only). The checked-out code is
   `headSha`: give the analyst `W` = a worktree at that commit if one exists,
   else `W: none` (it reads files with `git show <sha>:<path>`).
2. One finding per failing test or failing job step (sources `type: ci`).
3. Sections 2-6 as above, except: no `mark` and no `re-open` (those belong to a
   pipeline run); the bug's Environment is "GitHub Actions run <run-id>, <headSha>".
4. End with `STATUS: DONE: N findings triaged (<b> bugs filed: <keys>)`.
