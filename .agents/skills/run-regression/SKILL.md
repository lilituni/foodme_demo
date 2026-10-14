---
name: run-regression
description: Run the full automated regression suite (backend JUnit via Docker, frontend Playwright e2e) and report a structured pass/fail summary. Use when asked to run the tests, run regression, check if the test suite is green, or verify nothing broke. With a Jira key (/run-regression <T>) it is step 08 of the functional-testing workflow - runs the feature branch's suites against the running local SUT and writes runs/<T>/results.json.
---

# Run regression

**Called with a Jira key (`/run-regression KAN-11`)?** That is step 08 of the
functional-testing workflow: skip Steps 1-3 and follow "Feature run (step 08)"
at the end of this file. Its rules win where they differ from the steps above.

Runs every existing automated test in the repo - not just a single
test-case doc's cases - and reports results in a **consistent, structured
format** so repeated runs are easy to compare (not free-form prose that
varies in wording between invocations).

## Prerequisites

- Docker Desktop running. No local JDK or Node is assumed or required -
  backend tests run inside a container using the exact Gradle version the
  project pins, and frontend e2e tests run inside the official Playwright
  Docker image, so neither needs installing natively.
- For frontend e2e specifically: you need *something* to point Playwright
  at - either the local stack via `infra/docker-compose.yml`, or an
  already-deployed site (e.g. your own Render deployment). See Step 2 for
  both. If neither is available, skip e2e and say so explicitly in the
  report - don't invent a different way to bring up the stack as a silent
  workaround, and don't skip without saying so.
- **On Windows with Git Bash:** `docker run ... -w /app -v "C:\...:/app" ...`
  can fail immediately with `docker: Error response from daemon: the
  working directory '...' is invalid, it needs to be an absolute path` -
  Git Bash's MSYS layer rewrites the leading `/app` in `-w /app` as if it
  were a POSIX path on the host, mangling it before Docker ever sees it.
  Set `export MSYS_NO_PATHCONV=1` (or prefix the single command with
  `MSYS_NO_PATHCONV=1 docker run ...`) before any `docker run` that mixes
  a Windows-style `-v` mount with a POSIX-style `-w`. Confirmed needed for
  both the backend and web e2e commands below when run from Git Bash;
  not needed from PowerShell.

## Step 1 — Backend (JUnit via Docker)

Read the pinned Gradle version from
`apps/backend/gradle/wrapper/gradle-wrapper.properties`
(`distributionUrl=...gradle-<version>-bin.zip`) and the Java version from
`apps/backend/build.gradle`'s toolchain block, then run the suite inside a
matching `gradle:<version>-jdk<java-version>` container:

```bash
docker run --rm -v "<repo-root>/apps/backend:/app" -w /app gradle:<version>-jdk<java-version> \
  gradle test --no-daemon --console=plain
```

Use the image's built-in `gradle`, not `./gradlew` - the wrapper script
has CRLF line endings from a Windows git checkout, which breaks its
shebang inside the Linux container (`bad interpreter: No such file or
directory`).

Capture: total test count, pass/fail count, and the full name
(`ClassName > methodName()`) of every failing test, from the task output
(or `apps/backend/build/reports/tests/test/` if more detail is needed).

## Step 2 — Frontend e2e (Playwright via Docker)

Playwright itself runs inside the official image, matching each app's
pinned `@playwright/test` version from `package.json` (e.g. `^1.62.1` →
`mcr.microsoft.com/playwright:v1.62.1-jammy`). There are two valid targets
to point it at - pick whichever is available; local is preferred when
both are, since it doesn't depend on a deployed site being awake.

### Option A — local stack (`infra/docker-compose.yml`)

```bash
docker compose -f infra/docker-compose.yml --profile core up -d --build
# wait for backend health:
curl -sf http://localhost:8081/actuator/health | grep -q '"status":"UP"'

docker run --rm -v "<repo-root>/apps/web:/app" -w /app \
  -e PLAYWRIGHT_BASE_URL="http://host.docker.internal:3000" \
  -e VITE_API_BASE_URL="http://host.docker.internal:8081" \
  --add-host=host.docker.internal:host-gateway \
  mcr.microsoft.com/playwright:v1.62.1-jammy \
  bash -c "npm ci && npx playwright test --reporter=list"
```

Same pattern for `apps/admin` (its own `@playwright/test` version/image
tag, `ADMIN_BASE_URL` instead of `PLAYWRIGHT_BASE_URL`, port 3001) - but
see the admin caveat below first.

**Why `host.docker.internal`, not `localhost`:** the web/admin Docker
images bake their API URL into the JS bundle *at build time*
(`infra/docker-compose.yml`'s `VITE_API_BASE_URL` build arg already
defaults to `http://host.docker.internal:8081` for exactly this reason).
The test *browser* runs inside the Playwright container, where
`localhost` means that container's own loopback, not the host - so both
the browser's baked-in API calls and Playwright's own direct API calls
(`PLAYWRIGHT_BASE_URL`/`VITE_API_BASE_URL` env vars above) need
`host.docker.internal` to actually reach anything.

Tear down afterward regardless of outcome:
`docker compose -f infra/docker-compose.yml --profile core down -v`

### Option B — an already-deployed site (e.g. Render)

```bash
docker run --rm -v "<repo-root>/apps/web:/app" -w /app \
  -e PLAYWRIGHT_BASE_URL="https://<your-deployed-url>" \
  -e VITE_API_BASE_URL="https://<your-deployed-url>" \
  mcr.microsoft.com/playwright:v1.62.1-jammy \
  bash -c "npm ci && npx playwright test --reporter=list --workers=1"
```

No `CI=true` - `reuseExistingServer: !process.env.CI` in
`playwright.config.ts` needs to stay `true` so Playwright checks whether
`PLAYWRIGHT_BASE_URL` already responds instead of trying to spawn a local
dev server (which would fail anyway - no Node installed natively).

**Render free-tier cold start:** if the site has been idle, the first
run will show many unrelated-looking timeouts/failures as it wakes up
(1-3 min). That's not a regression - re-run once more before trusting the
results. Use `--workers=1` (serial) for this target specifically, so
parallel requests don't pile onto a server that's still waking up.

**Admin caveat - local only, not against a deployed site:** admin's e2e
specs navigate with root-relative paths (`page.goto("/#/login")`). In
production the admin SPA is mounted under `/backoffice`
(`apps/admin/vite.config.js`'s `base`), and a root-relative path resolves
against the *origin*, discarding any sub-path - so
`ADMIN_BASE_URL=https://your-site.com/backoffice` would actually navigate
to `https://your-site.com/#/login`, not `.../backoffice/#/login`. Only
run admin e2e against the local stack (Option A, where admin is published
on its own port at the root) until the spec files are updated to account
for this.

## Step 3 — Report

Always use this structure, so consecutive runs can be diffed easily:

```
Backend (JUnit): <pass>/<total> passed
  FAILED: <ClassName>::<methodName> - <one-line reason if available>
  ...

Frontend e2e (Playwright): <pass>/<total> passed | SKIPPED (<reason>)
  FAILED: <file>::<test name> - <one-line reason if available>
  ...
```

List every failing test by name - never collapse failures into "a few
tests failed." If a run's results differ from a previous run of the same
code (a test that passed before now fails, or vice versa, with no code
change in between), call that out explicitly - that's a flakiness signal,
not noise to smooth over.

## Known results, as of 2026-10-05 (10 consecutive full-scope runs)

The full suite (backend + web e2e) was run 10 times back to back against
unchanged code to separate real flakiness from one-off noise. See
`runs/regression.md` at the repo root for the full per-run table. Summary:

- **Backend (JUnit): fully deterministic, not flaky.** All 10 runs: 19
  tests, 16 passed, the same 3 failed every single time:
  - `OrderControllerTest > createOrder_fractionalDishPrice_subtotalKeepsCents()`
  - `OrderControllerTest > createOrder_dishFromDifferentChef_isRejected()`
  - `OrderControllerTest > deliveryPrice_subtotalEqualsFreeThreshold_isFree()`

  These are consistently-failing tests (likely real bugs or outdated
  assertions), not flaky ones - don't report them as "flaky," and don't
  "fix" them as part of an unrelated change without being asked.

- **Web e2e (Playwright): one flaky test observed, rate 1/10.**
  `e2e/happy-path.spec.ts:45:1 "dish modal additions raise cart line
  price"` failed once (run 8 of 10) with
  `locator.scrollIntoViewIfNeeded: Element is not attached to the DOM` /
  `element is not stable` at the line that scrolls the dish card into
  view before clicking it - a render-timing race, not a data problem. It
  passed the other 9/10 runs. If you see this exact failure, re-run
  before treating it as a real regression; if it starts failing at a
  materially higher rate, it's a candidate for the same fix pattern as
  `FM-FLAKE-05` (wait for a stable/visible locator state instead of an
  immediate action).
- All other 22 web e2e tests passed all 10/10 runs, including
  `flake-dish-modal.spec.ts` (`FM-FLAKE-01`) - it happened to pass every
  time in this sample. That's expected per its own doc (300ms is usually
  enough) and is **not** evidence it's been fixed; see
  `.agents/rules/flaky-tests.md` before touching it.

**Timing (this machine, Docker Desktop, image already pulled locally):**
- Backend suite: ~103-110s per run (one run took 130s with no obvious
  cause - no image pull and build outputs were already `UP-TO-DATE` in
  every run, so there's no clear cold-start effect here; treat ~110s as
  the normal case and don't read too much into one slower run).
- Web e2e suite: ~87-98s wall time per run, of which `npm ci` alone is
  ~57-60s **every run** - `npm ci` always wipes and reinstalls
  `node_modules` from scratch by design, so the mounted volume gives no
  caching benefit across runs. Actual Playwright execution (23 tests) is
  only ~27-33s of that. Don't be surprised the "fast" part of e2e is a
  small fraction of the command's wall time.

## Feature run (step 08: `/run-regression <T>`)

Step 08 of the functional-testing workflow (see the `feature-testing-pipeline`
skill). Argument: `T`. Run dir `R = agentic-workflows/functional-testing/runs/<T>/`.
It runs the **feature branch's** automated tests - the approved case tests
from step 06, the developer's tests for the feature, and everything else as
regression - and records what happened. It **judges nothing**: every failure
goes to step 09 (bug triage) as it is.

You write `R/results.json`, the raw reports under `R/raw/`, each case's
`regression` block in `R/spec.yaml` (nothing else in it), and `R/status`.
There's no human gate in this step.

### Rules (they override Steps 1-3 above)

- **Never start, stop, rebuild or tear down the stack** (no `up`, `down -v`,
  `restart`). The SUT is the one step 05 used. If it's down, stop and ask.
- **Never change a test, the app or a case**, and never add `test.fail`,
  `test.skip`, `@Disabled` or retries to the code. A red test stays red here.
- Run on the committed tests: `W` must be at or after `gates.yaml`'s
  `tests.commit`, and `git -C <W> status --porcelain -- apps/*/e2e apps/backend/src/test`
  must be empty. Otherwise `STATUS: NEEDS_HUMAN: <W> has uncommitted test changes (<files>)`.
- Timestamps from `date -u +%Y-%m-%dT%H:%M:%SZ`, at each suite's start and
  end - step 09 uses them to find the backend logs of a failure.
- Git Bash: prefix every `docker run` with `MSYS_NO_PATHCONV=1` and mount with `$(pwd -W)`.

### Gate

`R/gates.yaml` has `tests.approved: true`. Otherwise:
`STATUS: BLOCKED: step 06 is not approved; run /test-automation <T>`.

Resume: if `R/results.json` exists and its `tests_commit` is `gates.yaml`'s
`tests.commit`, the step is done - print its summary and end with `DONE`. A
different one means step 06 changed the tests: run again (the old file is
overwritten). A step 09 marker commit on top doesn't count as a change.

### 1. Entry check

Set `R/status` to `▶08 · entry check`. `W` = the `git worktree list` line
showing `[<branch>]` (`branch` from `spec.yaml`).

1. `curl -s <sut.api>/actuator/health` returns `"status":"UP"`.
2. The plan's entry check (section 5 of `plan.md`) still holds, as in step 05.

Either fails: `STATUS: NEEDS_HUMAN: start the SUT from <branch> (docker compose -f infra/docker-compose.yml --profile core up -d --build) and re-run`.

### 2. Sort the tests into groups

| Group | Which tests |
|---|---|
| `case` | the tests named in each case's `automation` block in `spec.yaml` (`<t>-cases.spec.ts`, `<Feature>CasesTest`) |
| `feature` | other test files the branch adds or changes: `git -C <W> diff --name-only main...HEAD -- apps/*/e2e apps/backend/src/test` |
| `other` | every other test - the regression of what already worked |

Suites to run: **backend** (always), **web** e2e (always), **admin** e2e only
if the branch diff touches `apps/admin/` or `apps/backend/` (the admin app
uses the same API). Record why admin was or wasn't run.

### 3. Run the suites (one after the other)

Set `R/status` to `▶08 · <suite> suite` before each. All from `W`.

**backend** (`W/apps/backend`, H2 - no stack needed). Image versions as in
Step 1; the named volume keeps the Gradle cache between runs:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/work" -v <t>_gradle_cache:/home/gradle/.gradle -w /work \
  gradle:<version>-jdk<java> gradle test --no-daemon --console=plain
```

Copy `build/test-results/test/*.xml` to `R/raw/backend/`. Then re-run each
**failing class** once (`gradle test --tests '<Class>'`): a test that fails
both times is `failed`; one that passes the second time is `flaky`.

**web** (`W/apps/web`). The SUT's web container has `http://localhost:8081`
baked in, which the Playwright container can't reach, so Playwright starts
its own dev server from `W` (as in step 06's dry run): don't set
`PLAYWRIGHT_BASE_URL`; set `VITE_API_BASE_URL`. The named volume keeps
`node_modules`; `npm ci` runs only when it's empty.

```bash
MSYS_NO_PATHCONV=1 docker run --rm --ipc=host -v "$(pwd -W):/work" -v <t>_web_nm:/work/node_modules -w /work \
  -e CI= -e VITE_API_BASE_URL=http://host.docker.internal:8081 \
  -e PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-report/step08-web.json \
  mcr.microsoft.com/playwright:v<web @playwright/test version>-jammy \
  bash -c "[ -x node_modules/.bin/playwright ] || npm ci; npx playwright test --reporter=list,json --retries=2"
```

`--retries=2` is a flag for this run, not a config change: a test that
passes on a retry is reported `flaky`; one that fails all 3 attempts is
`failed`. Copy `playwright-report/step08-web.json` to `R/raw/web.json`.

**admin** (`W/apps/admin`, when in scope): the same command with admin's
`@playwright/test` version, volume `<t>_admin_nm`, `ADMIN_BASE_URL` unset
(its config starts the dev server on 5174), output `step08-admin.json` →
`R/raw/admin.json`.

A suite that **didn't run** (compile error, image pull failed, dev server
never came up) is not a test failure: run it once more; if it fails again,
record `"status": "error"` with the first error line and go on with the other
suites. Docker down → `STATUS: NEEDS_HUMAN: start Docker Desktop and re-run`.

### 4. Compare

For every test in groups `case` and `feature`, and every **non-passing** test
in `other`:

- `case` tests: `expected_by_05` is `fail` when the case was a step 05
  `mismatch` (its test fails on purpose), else `pass`. `agrees_with_05` = the
  result matches it (`flaky` never agrees). `same_as_dry_run` = the result
  matches step 06's `dry_run`.
- `feature` / `other` failures: `baseline` = `known-failing` if the test is
  listed under "Known results" above (it fails on `main` too), else `new`.
  Don't run `main` to check - step 09 does that if it needs to.

### 5. Write `R/results.json` (Write tool, whole file)

```json
{
  "run": "KAN-11",
  "step": "08",
  "branch": "feature/KAN-11-promo-codes",
  "commit": "<W HEAD when run>",
  "tests_commit": "<gates.yaml tests.commit, e.g. e740a39>",
  "sut": { "api": "http://localhost:8081", "health": "UP", "entry_check": "pass" },
  "started": "<date -u>",
  "finished": "<date -u>",
  "suites": [
    { "name": "backend", "status": "ran", "started": "…", "finished": "…",
      "command": "<the command as run>", "raw": "raw/backend/",
      "total": 0, "passed": 0, "failed": 0, "flaky": 0, "skipped": 0 },
    { "name": "admin", "status": "not-run", "reason": "<why>" }
  ],
  "tests": [
    { "suite": "web", "group": "case", "case": "KAN-11-TC-04",
      "file": "e2e/kan-11-cases.spec.ts", "title": "KAN-11-TC-04 …", "project": "desktop",
      "status": "failed", "attempts": 3, "error": "<first line of the error>",
      "expected_by_05": "fail", "agrees_with_05": true, "same_as_dry_run": true },
    { "suite": "backend", "group": "other", "case": null,
      "file": "OrderControllerTest", "title": "createOrder_dishFromDifferentChef_isRejected()",
      "project": "junit", "status": "failed", "attempts": 2, "error": "…",
      "baseline": "known-failing" }
  ],
  "summary": {
    "cases": { "agree": 0, "disagree": 0 },
    "new_failures": 0, "known_failures": 0, "flaky": 0, "suite_errors": 0
  }
}
```

- `status`: `passed` | `failed` | `flaky` | `skipped`. `project`: `desktop`,
  `mobile` (a `[mobile]` title) or `junit`. Suite `status`: `ran` | `error` | `not-run`.
- `error`: the first line only, word for word. Never copy tokens, passwords
  or emails from test output.

Then set each case's `regression` block in `spec.yaml` (rewrite the whole
file; change nothing else):

```yaml
    regression:
      result: failed            # passed | failed | flaky | not-run (worst over its projects)
      projects: { desktop: failed }
      agrees_with_05: true
      at: "<date -u of its suite's end>"
```

A `manual-only` case gets `result: not-run`.

### 6. End

Set `R/status` (`✅08`, last part `done`) and show in chat:

- Per suite: `suite | status | passed | failed | flaky | skipped | time`.
- The cases: `case | 05 | expected | desktop | mobile | agrees`.
- Every non-passing `feature` / `other` test: `test | status | baseline | error`.
- Every disagreement (a case test vs 05, or vs the dry run) on its own line - step 09 starts there.

Ends:

- `STATUS: DONE: <N> tests run (<P> passed, <F> failed, <K> flaky); cases <A>/<C> agree with 05; <X> new failures; next /bug-triage <T> (step 09)`
- `STATUS: NEEDS_HUMAN: <what>` (SUT down, Docker down, uncommitted tests)
- `STATUS: BLOCKED: <reason>`
