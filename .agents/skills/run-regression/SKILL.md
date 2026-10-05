---
name: run-regression
description: Run the full automated regression suite (backend JUnit via Docker, frontend Playwright e2e) and report a structured pass/fail summary. Use when asked to run the tests, run regression, check if the test suite is green, or verify nothing broke.
---

# Run regression

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
