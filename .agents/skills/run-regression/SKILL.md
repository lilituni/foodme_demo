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
