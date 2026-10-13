---
name: feature-testing-pipeline
description: Entry point of the functional-testing workflow (/feature-testing-pipeline <T>, e.g. KAN-11). Runs the ISTQB test process for one Jira feature end to end in this session - requirements, plan, test cases + judge, manual execution, automation + judge, run, triage, report - pausing only for the human's reviews. Also resumes a run from the first unfinished step.
---

# Functional-testing workflow (ISTQB test process, human in the loop)

**Agents create, judges check (read-only), the human reviews and decides.**
The human never writes or edits a run file. Every pause is a review, in chat, of
something an agent just produced, and every approval is recorded in `gates.yaml`.

Argument: `T`, the Jira story key (e.g. `KAN-11`). If none was given, ask for it.

## Features in this release

| T | Feature | Spec | Branch (the code under test) |
|---|---|---|---|
| KAN-9 | Cancel order | `docs/specs/KAN-9-cancel-order-spec.md` | `feature/KAN-9-cancel-order` |
| KAN-10 | Order again | `docs/specs/KAN-10-order-again-spec.md` | `feature/KAN-10-order-again` |
| KAN-11 | Promo codes | `docs/specs/KAN-11-promo-codes-spec.md` | `feature/KAN-11-promo-codes` |

Jira: site `khachatryanlilith.atlassian.net`, cloudId `622d768a-dba9-44c8-883e-63e1f6724e8a`, project `KAN`.

**System under test (SUT).** These features are on branches, not on `main`, so
they are not deployed. The SUT is the local stack started from the feature's
branch (`docker compose -f infra/docker-compose.yml --profile core up -d --build`):
storefront `http://localhost:3000`, API `http://localhost:8081`. Step 01 writes
this into `spec.yaml`; later steps read it from there. Steps that need the
running app (05, 08) check it first and stop with `NEEDS_HUMAN` if it's down or
running the wrong branch - they never start or rebuild it on their own.

## Run directory `R = agentic-workflows/functional-testing/runs/<T>/`

| File | Written by |
|---|---|
| `spec.yaml` | 01 (ACs, out of scope, gap questions + the human's answers), 03 (test cases), 05/08 (per-case results) |
| `gates.yaml` | each step, **only right after the human approves in chat** - the audit trail of every review |
| `plan.md` | 02 |
| `verdicts/04-NN.json`, `verdicts/07-NN.json` | 03 / 06, the judge subagents' verdicts, saved word for word |
| `execution.md` | 05, the manual run log (UTC time per case, for triage) |
| `results.json` | 08 |
| `triage.json` | 09, written by the bug-triage workflow |
| `report.md`, `report.html` | 10 |
| `status` | this skill: one line for the Claude Code status line |

### Writing run files

Write a run file by rewriting the **whole file with the Write tool** (read it
first, change it, write it back). Don't patch YAML with shell heredocs or inline
`node -e` / `sed` scripts: quoting and Windows line endings break them. The one
exception is the one-line `status` file, which may be written with `echo`.

**Timestamps come from the clock, never from your head.** Before writing any
`at:` / `answered_at:` / `Started:` value, run `date -u +%Y-%m-%dT%H:%M:%SZ` and
copy its output. A made-up time breaks the audit trail in `gates.yaml`.

## Steps

| # | ISTQB activity | Step skill | Produces | Human gate (`gates.yaml` key) | Built |
|---|---|---|---|---|---|
| 01 | Test analysis (test basis review) | `requirements-gathering` | `spec.yaml`: ACs, out of scope, gap questions | answers to gap questions, then approve → `requirements` | ✅ |
| 02 | Test planning | `test-planning` | `plan.md` | approve → `plan` | ✅ |
| 03 + 04 | Test design + review | `test-case-design` (calls subagent `case-judge`) | `test_cases` in `spec.yaml`, `verdicts/04-*` | approve → `cases` | ✅ |
| 05 | Test execution (manual) | `test-execution` | `execution.md`, per-case result + confidence | check every case the agent isn't sure about → `manual_check` | ✅ |
| 06 + 07 | Test implementation + review | `test-automation` (calls subagent `test-judge`) | Playwright / JUnit tests on the feature branch (one per case, dry-run vs 05), `verdicts/07-*` | approve (+ commit, push only if asked) → `tests` | ✅ |
| 08 | Test execution (automated) | `run-regression <T>` (its "Feature run" section) | `results.json`, per-case `regression` in `spec.yaml` | - | ✅ |
| 09 | Defect triage | **bug-triage workflow** (`/bug-triage <T>`, separate; calls subagent `triage-analyst`) | `triage.json`, Jira bugs, known-bug markers | decide each finding, then approve the actions → `triage` | ✅ |
| 10 | Test completion | `test-reporting` | `report.md`, `report.html`, Qase run | approve → `report` | ⏳ |

ISTQB's *test monitoring and control* runs across all steps: it is this skill's
`status` file and `gates.yaml`, plus the stop rules below.

Step 09 is its own workflow so it can also run outside this pipeline (e.g. on a
failing CI run). This skill calls it like any other step; the bug-triage
workflow does its own human approvals and writes `R/triage.json`, which step 10
reads. No bug is filed in Jira before a human approves it in step 09.

## How to run

1. Make sure `R` exists. Work out the first unfinished step (a fresh run starts at 01):
   - 01 done: `spec.yaml` has `acs`, every question has an `answer`, and `gates.yaml` has `requirements.approved: true`.
   - 02 done: `plan.md` exists and `plan.approved: true`.
   - 03 + 04 done: `test_cases` is not empty and `cases.approved: true`.
   - 05 done: every case has `execution.result`, every `unsure` case has a `human_check`, and `gates.yaml` has `manual_check`.
   - 06 + 07 done: every automatable case has `automation`, and `tests.approved: true`.
   - 08 done: `results.json` exists and its `tests_commit` is `gates.yaml`'s `tests.commit`.
   - 09 done: `triage.json` exists and `triage.approved: true`.
   - 10 done: `report.md` exists and `report.approved: true`.
2. Print one line: `Run <T>: starting at step NN (done: 01, 02, …)`.
3. **Load that step's skill with the Skill tool**, passing only `T`, and follow it completely, including its human review.
4. When the step ends with `STATUS: DONE`, go straight on to the next step in the same turn. Moving on is not a decision for the human; the reviews inside each step are.
5. If the next step's skill isn't built yet (`⏳` in the table), stop with `STATUS: BLOCKED: step NN (<skill>) is not built yet`.

### When to stop - and only then

- A step asks the human (AskUserQuestion): that's a pause inside the step, not a stop. Continue after the answer.
- `STATUS: NEEDS_HUMAN: <what>` from a step: the human chose to stop, or only they can do something (start the app, sign in). Stop.
- `STATUS: BLOCKED: <reason>`: stop.

**Never set a gate yourself to keep the flow moving.** A gate is written only by the step, right after the human picks "Approve".

## Feedback loops (going back)

A judge or a later step can find a problem that an *earlier, approved* step
owns. The rule: **a step fixes only its own output; anything earlier is
re-opened only by the human.**

| Found in | Problem | Owner | What happens |
|---|---|---|---|
| 04 case-judge | J3–J6: a case's expected value, steps, scope or duplication | 03 | 03 fixes the case and re-runs the judge (max 2 rounds). No going back. |
| 04 case-judge | J1: an AC misquoted in `spec.yaml` | 01 | Human: `Re-open requirements (step 01)` |
| 04 case-judge | J2: a gap in the sources with no question | 01 | Human: `Re-open requirements` to add and answer the question, or approve the cases as they are |
| 04 case-judge | J7: the cases disagree with the plan **because the plan is wrong** | 02 | Human: `Re-open the plan (step 02)`; if the *cases* are wrong, 03 fixes them |
| 07 test-judge | a test doesn't match its approved case | 06 | 06 fixes the test and re-runs the judge |
| 09 triage | a failure caused by a wrong test | 06 | back to 06 (approved by the human in triage) |
| 09 triage | a failure caused by a spec gap | 01 | back to 01 (approved by the human in triage) |

Re-opening a step:

1. The human picks the re-open option in a review (AskUserQuestion). The step ends with `NEEDS_HUMAN: re-run /<step skill> <T>`.
2. The human confirms in chat; then remove that step's gate entry from `gates.yaml` **and the gates of every later step**, and record why under `reopened:` in `gates.yaml` (`{ step, by, at, reason }`) so the history isn't lost.
3. On the next `/feature-testing-pipeline <T>`, the resume check finds that step unfinished and starts there. Files of later steps are kept as drafts: those steps re-check them against the changed input instead of starting from scratch.
4. A re-opened step that finds its own file already written must **first apply the newest `reopened` reason for that step** to the file, show the change in chat, and only then run its human review. It never re-approves an unchanged file.

## Status line (`R/status`)

The status line (`workflows/statusline.sh`) shows the first line of `R/status`.
Overwrite that file (one line) whenever the state changes: a step starts, right
before every AskUserQuestion, after the answer, when a judge or subagent runs,
and when you stop.

```
Feature Testing <T> │ ✅01 ✅02 ▶03 ⏳04 ⏳05 ⏳06 ⏳07 ⏳08 ⏳09 ⏳10 │ 03 Test cases · case-judge round 2
```

- One mark per step: `✅` done, `▶` running, `🧑` waiting for the human, `⛔` blocked, `⏳` not started.
- The last part is short: `reading Jira`, `🧑 answer 3 gap questions`, `🧑 approve requirements`, `case-judge round 2`, `⛔ app not running`, `⛔ step 02 not built`, `done`.
- The file only displays state. Never read it to decide what to do; the rules in "How to run" decide that.

## Final reply (end of the run, or when stopped)

```markdown
Run: <T> · agentic-workflows/functional-testing/runs/<T>/

| # | Step | State |
|---|---|---|
| 01 | Requirements | ✅ approved by <by> at <at> · 🧑 waiting for you · ⛔ blocked · ⏳ not started |
| … | one row per step 01–10 | |

<done: report path, Qase link, Jira bugs filed> or <stopped: why, and what the human needs to do>
To resume: /feature-testing-pipeline <T>

STATUS: DONE | NEEDS_HUMAN: <what> | BLOCKED: <reason>
```
