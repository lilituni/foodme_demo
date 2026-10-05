# Regression runs — 2026-10-05

10 consecutive full-scope regression runs (backend JUnit + web Playwright
e2e), executed back to back against unchanged code, per the
`run-regression` skill's full-scope checks. Goal: tell real flakiness
apart from one-off noise, with real executed commands (no estimates).

Environment: Windows, Docker Desktop (no local JDK/Node). Local stack
(`infra/docker-compose.yml --profile core`) was already up and healthy
from a prior session and was reused for all 10 runs rather than rebuilt
each time. Backend tests ran via `gradle:8.6-jdk17` (matches
`apps/backend/gradle/wrapper/gradle-wrapper.properties` and the Java 17
toolchain in `build.gradle`); web e2e ran via
`mcr.microsoft.com/playwright:v1.62.1-jammy` against the local stack
(`PLAYWRIGHT_BASE_URL=http://host.docker.internal:3000`,
`VITE_API_BASE_URL=http://host.docker.internal:8081`).

One piece of friction hit immediately and documented in `SKILL.md`:
Git Bash's MSYS layer mangles `-w /app` in `docker run` when mixed with a
Windows-style `-v` mount (`the working directory '...' is invalid`).
Fixed for all 10 runs below by exporting `MSYS_NO_PATHCONV=1` before every
`docker run` call. No other infrastructure failures occurred across all
20 command executions (10 backend + 10 web e2e) - every number below is
from a real completed run, nothing retried or estimated.

## Backend (JUnit), 19 tests total

| Run | Passed | Failed | Wall time | Gradle-reported build time |
|-----|--------|--------|-----------|------------------------------|
| 1   | 16     | 3      | 130s      | 2m 8s |
| 2   | 16     | 3      | 109s      | 1m 47s |
| 3   | 16     | 3      | 103s      | 1m 41s |
| 4   | 16     | 3      | 104s      | 1m 42s |
| 5   | 16     | 3      | 109s      | 1m 47s |
| 6   | 16     | 3      | 107s      | 1m 45s |
| 7   | 16     | 3      | 106s      | 1m 44s |
| 8   | 16     | 3      | 105s      | 1m 43s |
| 9   | 16     | 3      | 107s      | 1m 45s |
| 10  | 16     | 3      | 108s      | 1m 46s |

**Same 3 tests failed in all 10 runs** (100% consistent — not flaky, a
deterministic failure):
- `OrderControllerTest > createOrder_fractionalDishPrice_subtotalKeepsCents()`
- `OrderControllerTest > createOrder_dishFromDifferentChef_isRejected()`
- `OrderControllerTest > deliveryPrice_subtotalEqualsFreeThreshold_isFree()`

All other 16 backend tests passed all 10/10 runs.

Timing was consistent run to run (~103-109s) except run 1 at 130s. No
image pull happened on run 1 (the `gradle:8.6-jdk17` image was already
local) and `:compileJava`/`:classes`/etc. were already `UP-TO-DATE` in
every run including run 1, so there's no clear cold-start explanation for
run 1 being slower — most likely ordinary variance (host CPU/disk
contention from the already-running compose stack and whatever else was
active), not a pattern. Runs 2-10 cluster tightly.

## Web e2e (Playwright), 23 tests total

| Run | Passed | Failed | Wall time | Playwright-reported test time | `npm ci` time |
|-----|--------|--------|-----------|-------------------------------|---------------|
| 1   | 23     | 0      | 96s       | 32.5s | 60s |
| 2   | 23     | 0      | 93s       | 27.9s | ~60s |
| 3   | 23     | 0      | 87s       | 26.8s | 57s |
| 4   | 23     | 0      | 92s       | 29.1s | 59s |
| 5   | 23     | 0      | 98s       | 31.7s | ~60s |
| 6   | 23     | 0      | 95s       | 30.6s | ~60s |
| 7   | 23     | 0      | 94s       | 30.3s | ~60s |
| 8   | 22     | 1      | 92s       | 28.3s | ~60s |
| 9   | 23     | 0      | 91s       | 28.0s | ~60s |
| 10  | 23     | 0      | 91s       | 26.7s | ~60s |

**Flaky test found — 1/10 observed failure rate:**
`e2e/happy-path.spec.ts:45:1 "dish modal additions raise cart line
price"` failed only on run 8:

```
Error: locator.scrollIntoViewIfNeeded: Element is not attached to the DOM
Call log:
  - attempting scroll into view action
    2 × waiting for element to be stable
      - element is not stable
    ...
> 69 | await dishBtn.scrollIntoViewIfNeeded();
```

This is a render-timing race on the dish card (the element moved/re-rendered
while Playwright was trying to scroll it into view), not a data or
environment problem — it passed normally on the other 9 runs with no code
changes in between.

**All other 22 web e2e tests passed all 10/10 runs**, including the
intentionally-flaky `flake-dish-modal.spec.ts` (`FM-FLAKE-01`) and the
already-fixed `flake-cart-persistence.spec.ts` (`FM-FLAKE-05`) — both
passed every single time in this sample. Per `.agents/rules/flaky-tests.md`,
`flake-dish-modal.spec.ts` is *expected* to usually pass (300ms is usually
enough); passing 10/10 here is not evidence it's fixed and it was left
untouched, per that rule.

`npm ci` reinstalled all 115 packages from scratch in ~57-60s on every
single run (no caching benefit from the mounted volume, since `npm ci`
always wipes `node_modules` first) — this is roughly 60-65% of each web
e2e run's wall time, with actual Playwright test execution only taking
~27-33s.

## Summary of what changed in `SKILL.md` and why

Edited `.agents/skills/run-regression/SKILL.md`:

1. Added a Windows/Git Bash prerequisite note about `MSYS_NO_PATHCONV=1`
   being required before `docker run` commands that mix a Windows `-v`
   path with a POSIX `-w /app` — without it, Docker fails immediately
   with an "invalid working directory" error. This was hit on the very
   first command of this session and wasn't documented anywhere before.
2. Added a "Known results" section recording, from these 10 real runs:
   - The 3 backend tests that fail consistently (100%) and are not flaky.
   - The one web e2e test observed to be flaky (1/10) and its exact
     failure signature, so a future run that hits it once isn't
     mistaken for a regression.
   - That `flake-dish-modal.spec.ts` passed all 10/10 in this sample,
     explicitly flagged as not a signal that it's fixed.
   - Realistic timing expectations for both suites, including the
     `npm ci` cost that dominates e2e wall time.

No other files were touched besides this log and the skill file, as
instructed. Nothing was committed.
