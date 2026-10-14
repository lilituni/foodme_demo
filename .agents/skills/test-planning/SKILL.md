---
name: test-planning
description: Step 02 of the functional-testing workflow (/test-planning <T>) - write runs/<T>/plan.md, the test plan for one feature's approved requirements (scope, approach per AC with partitions and boundaries, test levels, test data with the arithmetic, environment and entry criteria, risks, exit criteria), then get the human's approval in chat. ISTQB test planning.
---

# Step 02: Test plan

Argument: `T`. Run dir `R = agentic-workflows/functional-testing/runs/<T>/`.
You write `R/plan.md` (one plan per feature), and the `plan` entry of
`R/gates.yaml` after the human approves.

If `R/plan.md` already exists, skip to "Human review" (a resumed review) -
unless `R/gates.yaml` has a `reopened` entry for step `02` and no `plan` gate:
then first apply that entry's `reason` to `plan.md`, show what changed, and go
to "Human review".

## Gate

`R/gates.yaml` has `requirements.approved: true` and every question in
`R/spec.yaml` has an `answer`. Otherwise:
`STATUS: BLOCKED: step 01 is not approved; run /requirements-gathering <T>`.

## Read

- `R/spec.yaml`: `acs`, `out_of_scope`, `notes`, the answered `questions`, `branch`, `sut`. **The answers are now part of the requirements** - an expected value that depends on a question cites it (e.g. "rounded down, Q-2").
- The spec doc in `sources.doc`, for shared facts (launch data, fees, outcome tables).
- **Test data**, read-only:
  1. Preferred: the running SUT's public API with GETs (`curl -s <sut.api>/api/chef/active?page=0&size=50`, `curl -s <sut.api>/api/chef/<id>`). Writes nothing.
  2. If the API isn't reachable: the seed data in `apps/backend/src/main/resources/db/migration/*.sql` - only `INSERT` rows for chefs and dishes, found with `grep` (the file is large; never read it whole). Mark every value taken this way `(seed - verify in 05)`.

Don't read the app's source code (controllers, services, components) to decide what is correct. The app may be wrong - that's what we're testing.

## Write `R/plan.md`

Short and concrete. Sections:

1. **Test items**: feature `T`, branch, and the commit under test (`git rev-parse --short <branch>`).
2. **Scope**: ACs in scope (ids); out of scope (from `spec.yaml`); anything else you won't test, with the reason (e.g. Q-10: signed-out customers).
3. **Approach per AC**: a table
   `AC | partitions / boundaries | technique | level | settles it | cases planned`
   - *technique*: equivalence partitioning, boundary value analysis (below / at / above a limit), decision table (several conditions → one outcome), state transition (apply → replace → remove; cart change after apply).
   - *level*: `UI` (customer-visible behaviour, manual in 05, Playwright in 06) or `API` (server rules that the UI can't reach cleanly, e.g. the re-check at order placement - JUnit/API test in 06). Prefer `UI`; use `API` only when the UI can't produce the condition.
   - *settles it*: the AC or answered question that fixes the expected value.
   Aim for **8–14 cases in total**, no two covering the same partition.
4. **Test data**: per partition, the chef, dish(es), quantities and the resulting subtotal **with the arithmetic shown** (e.g. `2 × 1,800 = 3,600 ≥ 3,000 ✔`). Reuse the same chef and dishes wherever possible. Include the expected discount/total arithmetic where an AC needs it, applying the answered rules (e.g. rounding).
5. **Environment & entry criteria for execution (05, 08)**:
   - SUT: the local stack started from `branch` (`docker compose -f infra/docker-compose.yml --profile core up -d --build`), storefront `sut.web`, API `sut.api`, `GET <sut.api>/actuator/health` = `UP`.
   - Browser for step 05: the built-in browser pane; Claude in Chrome as fallback.
   - Customer: a test account registered on the **local** SUT for this run (local host only; never a real account).
   - Known noise to ignore: simulated API latency, backend cold start, a stale cart or applied code left from an earlier case.
6. **Risks**: what could make a correct app look broken (latency, a leftover cart, wrong branch running) and what could make a broken app look correct (asserting what the app shows instead of what the AC and answers say; test data that never reaches a boundary).
7. **Exit criteria**: every AC covered by at least one case; every case executed in 05; every automatable case automated in 06 and run in 08; every mismatch and failure triaged in 09 and listed in the report.
8. **Roles and approvals**: who approves what (the human: requirements, plan, cases, unsure results, tests, each triage finding, the report; the judges only advise).

Update `R/status` while you work: `▶02 · reading test data`, then `▶02 · writing plan`.

## Human review (in chat)

Set `R/status` to `🧑02 · approve the plan`. Show the approach table and the test data in chat, the total number of planned cases, and the path `runs/<T>/plan.md`. Then ask with **AskUserQuestion**: `Approve plan` / `Request changes` / `Stop here`.

- `Request changes`: update `plan.md` with the notes, show what changed, and ask again.
- `Approve`: add the `plan` entry to `R/gates.yaml` (keep the other entries): `{ approved: true, by: <git config user.name>, at: <UTC now>, note: <the human's note or ""> }`.
- `Stop here`: end with `NEEDS_HUMAN`.

## End

- `STATUS: DONE: plan approved (N cases planned); next /test-case-design <T>`
- `STATUS: NEEDS_HUMAN: <what is still open>`
- `STATUS: BLOCKED: <reason>`
