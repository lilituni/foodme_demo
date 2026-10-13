---
name: test-automation
description: Step 06 (+ 07) of the functional-testing workflow (/test-automation <T>) - turn every approved, executed test case of runs/<T>/spec.yaml into an automated test on the feature branch (Playwright for UI cases, JUnit/MockMvc for API cases), one test per case named by its case id; dry-run them once and compare with the manual results of step 05; have the read-only test-judge subagent check them (max 2 fix rounds); then get the human's approval in chat. ISTQB test implementation + review.
---

# Step 06: Automate the cases (and step 07: test judge)

Argument: `T`. Run dir `R = agentic-workflows/functional-testing/runs/<T>/`.
You write test files **on the feature branch** (the code under test), each
case's `automation` block in `R/spec.yaml`, the judge's verdicts in
`R/verdicts/07-NN.json`, and the `tests` entry of `R/gates.yaml` after the human
approves. In `spec.yaml` you change **only** each case's `automation` block.

## Gate

`R/gates.yaml` has `cases.approved: true` and every case has `execution.result`
(step 05 done). Otherwise:
`STATUS: BLOCKED: step 05 is not done; run /test-execution <T>`.

Resume: if every case already has `automation`, go to "Judge" when `R/verdicts/`
has no `07-*` verdict newer than the test files, otherwise to "Human review".

## Where the tests go

Tests belong to the feature, so they go on `branch` from `spec.yaml`, not on
this workflow's branch. Find the checkout with `git worktree list` (the line
showing `[<branch>]`), call it `W`. If none exists:
`STATUS: NEEDS_HUMAN: check out <branch> in a worktree (git worktree add ../foodme_<t> <branch>) and re-run`.
Never switch the branch of this repo's own checkout.

| Case `level` | Test | File in `W` |
|---|---|---|
| `UI` | Playwright | `apps/web/e2e/<t>-cases.spec.ts` (admin flows: `apps/admin/e2e/<t>-cases.spec.ts`) |
| `API` | JUnit 5 + MockMvc | `apps/backend/src/test/java/am/foodme/backend/<Feature>CasesTest.java` (e.g. `PromoCodeCasesTest`) |

These files hold **only** tests generated from approved cases. Don't edit the
developer's own tests in the branch (e.g. `promo-codes.spec.ts`), and don't
read them for expected values - they were written from the code.

## Write the tests

Set `R/status` to `▶06 · writing tests`. Read `R/spec.yaml` (cases with their
`execution`), `R/plan.md`, and - for conventions only - one existing spec of the
same app (`apps/web/e2e/auth.ts`, `storefront-flows.spec.ts`) or test class
(`OrderControllerTest.java`, `src/test/resources/data.sql`). Rules, all checked by the judge:

- **One test per case**, title starting with the case id:
  `test("KAN-11-TC-04 TREAT15 at 8,050: discount rounded down", …)`. JUnit:
  `@DisplayName("KAN-11-TC-14 …")`, method `tc14_<scenario>_<outcome>`.
- **The case is the spec.** Steps in the case's order, with the case's data
  (chef, dishes, quantities, delivery method, exact code typed). One assertion
  per `expected` fact, asserting the case's value word for word (numbers as
  shown in the case, e.g. `"1,207 AMD"`). Comment each assertion with the fact
  it checks (`// expected[1]`).
- **Never assert what the app did instead.** A case that was a `mismatch` in
  step 05 still asserts the case's expected value, so its test **fails** - that
  failure is the bug's evidence, and only step 09 may mark it as a known bug.
  Never add `test.fail`, `test.skip`, `@Disabled` or a weaker assertion here.
- **Observable oracles only:** text and values via role/label/text locators and
  web-first assertions (`toHaveText`, `toBeDisabled`, `toHaveCount`). A fact the
  manual run could only read from a DOM property (e.g. TC-11's disabled button)
  is fine to assert with `toBeDisabled()` - that's what automation adds.
- **No fixed waits** (`page.waitForTimeout`, `Thread.sleep`) - see
  `.agents/rules/flaky-tests.md`; wait on the real signal (FM-FLAKE-05 pattern).
- **Independent tests:** each test signs up its own customer (UI: through the
  app's API like `auth.ts` does; never the run's `test-account.yaml`, never a
  real account) and starts from an empty cart. No order between tests, no
  shared state; the web suite runs `fullyParallel`.
- An order placed by a test uses the note the case gives (e.g. TC-13's
  `STLC KAN-11 TC-13`); a case that gives no note gets `STLC <T> <case-id> auto`.
- **Desktop + mobile:** the plan's main success case(s) (the first case of the
  main flow, e.g. TC-01) also run on a phone viewport:
  `test.describe("mobile", () => { test.use({ ...devices["Pixel 7"] }); … })`,
  titled `<case-id> [mobile] …`. Don't change `playwright.config.ts`.
- API cases test the endpoint the case names, with the case's request body;
  test data goes in the test (or `data.sql` if the existing tests do it that
  way). Never touch Flyway migrations (`.agents/rules/migrations-are-append-only.md`).
- A case that can't be automated faithfully (e.g. it needs a second real
  device) gets `automation: { status: manual-only, reason: "<why>" }` instead of
  a weaker test.

Then set each case's `automation` in `spec.yaml` (rewrite the whole file):

```yaml
    automation:
      status: automated            # automated | manual-only
      file: apps/web/e2e/kan-11-cases.spec.ts
      test: "KAN-11-TC-04 TREAT15 at 8,050: discount rounded down"
      projects: [desktop]          # [desktop, mobile] for the main flow; [junit] for API
      dry_run: fail                # pass | fail | error, from the dry run below
      agrees_with_05: true
```

## Dry run (once, against the running SUT)

Set `R/status` to `▶06 · dry run`. Only the new tests, once - this is a check of
the tests, not step 08's run. Use `run-regression`'s Docker commands (Git Bash
needs `MSYS_NO_PATHCONV=1`), scoped:

- Playwright: `npx playwright test e2e/<t>-cases.spec.ts --reporter=list` in
  `W/apps/web`. If the SUT's web container has `http://localhost:8081` baked in
  (unreachable from inside the Playwright container), let Playwright start its
  own dev server from `W` instead: don't set `PLAYWRIGHT_BASE_URL`, set
  `VITE_API_BASE_URL=http://host.docker.internal:8081`. Say which in the record.
- JUnit: `gradle test --tests '*<Feature>CasesTest'` in `W/apps/backend` (H2,
  no stack needed).

Don't start, stop or rebuild the stack (same rule as step 05).

Compare each test with the case's step 05 result:

| Step 05 | Dry run | Means |
|---|---|---|
| match | pass | ✅ agrees |
| mismatch | fails on a `failed_facts` assertion | ✅ agrees - the test catches the bug |
| match | fails | ❌ the test is probably wrong (selector, wait, data) - fix it and dry-run that test again; if it still fails, report it to the human |
| mismatch | pass, or fails on another fact | ❌ the test doesn't check what the case checks - fix it |
| any | error (compile, timeout, setup) | ❌ fix it |

Fix only the test, never the case and never the app. At most 2 fix rounds per
test; a test that still disagrees goes to the human with `agrees_with_05: false`
and the error.

## Judge (step 07)

1. Set `R/status` to `▶07 · test-judge round N`.
2. Run the `test-judge` subagent (Agent tool, `subagent_type: test-judge`) with the prompt `Judge the automated tests of <T>; feature checkout: <W>`.
3. Save its final fenced JSON block **word for word** to `R/verdicts/07-NN.json` (`NN` = next free number). Don't edit or re-judge it.
4. `pass` → "Human review". `fail` → fix the named tests, dry-run them again, judge again (max **2** rounds), then "Human review" with what's left. `unsure` → "Human review" with the UNSURE checks. `blocked` → fix nothing; "Human review" with the obstacles.

A judge FAIL that says the **case** is wrong is not yours to fix: the case is
approved (step 03). Leave it for the human (see "Feedback loops" in the
pipeline skill).

## Human review (in chat)

Set `R/status` to `🧑07 · review N tests`. Show:

- A table `case | 05 result | test (file::title) | projects | dry run | agrees`.
- The test files' paths in `W` and the diff size (`git -C <W> diff --stat`).
- Every verdict file in order, and every non-PASS check: `check | test | reason` with both quotes; obstacles.
- The mismatching cases whose tests fail on purpose, and that step 09 decides what happens to them.

Ask with **AskUserQuestion**: `Approve tests` / `Request changes` / `Stop here`.

- `Request changes`: apply the notes (same rules), dry-run the changed tests, judge again (a new verdict file), ask again.
- `Approve`: commit the test files in `W` on `branch` (message `<T>: automate approved test cases (step 06)`, the repo's attribution lines; the secrets hook applies). **Don't push** - ask "Push `<branch>` now?" as a second AskUserQuestion (`Push` / `Not now`) and push only on `Push`. Then add the `tests` entry to `R/gates.yaml` (keep the others): `{ approved: true, by: <git config user.name>, at: <date -u>, commit: <short sha>, pushed: true|false, note: "judge 07-NN <verdict>" + the human's note }`.
- `Stop here`: leave the files uncommitted and end with `NEEDS_HUMAN`.

## End

- `STATUS: DONE: N tests approved (A automated, M manual-only; judge 07-NN <verdict>); next /run-regression <T> (step 08)`
- `STATUS: NEEDS_HUMAN: <what>`
- `STATUS: BLOCKED: <reason>`
