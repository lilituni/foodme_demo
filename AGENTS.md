# CLAUDE.md

Guidance for Claude Code (and any AI coding agent) working in this repository.

## What this is

FoodMe — a small food-ordering application used as a teaching project for
AI-assisted QA / AI-assisted engineering. It has a customer storefront, an
admin back-office, a Spring Boot API, and a self-hosted monitoring stack
(Grafana/Prometheus/Loki). Everything deploys as free-tier services on Render.

## Monorepo layout

```
apps/
  backend/   Spring Boot 3 (Java 17, Gradle) — REST API, Postgres, JWT auth
  web/       Customer storefront — React 19 + Vite + TypeScript + Tailwind + Radix UI
  admin/     Back-office — React 18 + Vite + MUI + react-admin
infra/
  monitoring/  Grafana + Prometheus + Loki stack (render-monitoring.yaml target)
.github/workflows/  CI: per-app build/lint, Playwright e2e, Docker image builds
render.yaml               Render blueprint for the app (backend + web + admin)
render-monitoring.yaml    Render blueprint for the monitoring stack
```

Routing: storefront is served at `/`, the admin panel at `/backoffice`.

## Commands

### Backend (`apps/backend`)
```
./gradlew build     # compile + run unit tests
./gradlew test      # unit tests only
./gradlew bootRun   # run locally
```
- Java 17, Spring Boot 3.3.4, JPA + PostgreSQL, Flyway migrations
  (`src/main/resources/db/migration`).
- JWT auth (`com.auth0:java-jwt`); customer and admin auth are separate
  controllers/flows (`controller/api` vs `controller/admin`).
- Observability baked in: Micrometer/Prometheus scrape endpoint, JSON logs
  shippable to Loki, Sentry/GlitchTip error reporting.
- Health check: `GET /actuator/health` (used by CI and Docker healthchecks).

### Web storefront (`apps/web`)
```
npm run dev          # local dev server (Vite)
npm run build         # tsc -b && vite build
npm run lint           # oxlint
npm run test:e2e        # Playwright e2e
npm run test:e2e:all     # this app's e2e + admin's e2e
```

### Admin (`apps/admin`)
```
npm run dev       # local dev server (Vite)
npm run build      # vite build
npm run lint         # eslint
npm run test:e2e     # Playwright e2e
```

## Testing

- Unit tests: JUnit 5 for the backend (`apps/backend/src/test`), run via
  `./gradlew test`.
- E2E tests: Playwright, per app, under `apps/web/e2e` and `apps/admin/e2e`.
- `apps/web/e2e` includes spec files prefixed `flake-*` kept for teaching
  purposes — see @.agents/rules/flaky-tests.md before touching any of them.
- CI (`.github/workflows/ci.yml`) runs: backend build+test, web lint+build,
  admin lint+build, then a full Playwright e2e run against the app started
  via `docker compose -f infra/docker-compose.yml --profile core`, plus
  Docker image builds for all three apps.
- When asked to add or generate tests, match the existing style and location
  for that layer (JUnit for backend logic, Playwright specs for user-facing
  flows) rather than introducing a new test framework.

## Environment

- Copy `.env.example` to `.env` for local runs.
- A `PreToolUse` hook (`.agents/hooks/check-secrets.sh`, wired in
  `.agents/settings.json`) blocks any `git commit` whose staged diff
  looks like it contains a real secret (API key, private key, a DSN with
  embedded credentials). For what the hook can't catch (sync'ing
  `.env.example`, not copying the one known hardcoded exception), see
  @.agents/rules/secrets-and-env.md.
- Local Postgres + services are wired through `infra/docker-compose.yml`
  (profile `core`).

## Conventions

- Backend package structure and the `controller/admin` vs `controller/api`
  split are load-bearing, not arbitrary — see
  @.agents/rules/backend-package-boundaries.md.
- Frontend apps are independent Vite projects with their own lint configs
  (`web` uses `oxlint`, `admin` uses `eslint`) — don't unify them without
  being asked.
- Flyway migrations under `apps/backend/src/main/resources/db/migration`
  are append-only — see @.agents/rules/migrations-are-append-only.md.
- Don't strip or weaken Prometheus/Sentry/Loki instrumentation as a side
  effect of other changes — see @.agents/rules/observability-must-survive.md.
- This repo is also a workshop artifact: some files that look like cleanup
  candidates are intentional course material — see
  @.agents/rules/workshop-artifacts.md before touching `render.yaml`'s
  service name, the root-level `.patch` files, or `README.md`'s structure.
