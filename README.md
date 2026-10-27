# AI-Assisted QA Automation

Hands-on project from the **AI in QA** course at Armenian Code Academy (October 2026) — [certificate](docs/certificate.pdf).
It explores how AI agents (Claude Code) can take on real QA work — test design, execution,
defect management, code review and CI quality gates — while keeping human review and
repeatability checks in the loop.

> **About the codebase:** *FoodMe* (Spring Boot API, React storefront, react-admin back-office,
> Grafana/Prometheus/Loki monitoring) is the course's base application. The QA tooling around it —
> skills, subagents, hooks, workflows and tests — is my work.

## What I built

### 1. An agentic functional-testing pipeline (ISTQB-based)
A ten-step workflow ([`feature-testing-pipeline`](.agents/skills/feature-testing-pipeline)) that takes a
Jira story from requirements to a test completion report: requirements → test plan → test-case design →
manual execution → automation → regression run → bug triage → report, pausing for human approval at each review.
- Read-only **judge subagents** check the agent's own output ([`case-judge`](.agents/agents/case-judge.md),
  [`test-judge`](.agents/agents/test-judge.md)), with a limited number of fix rounds.
- Applied end to end to real features: [KAN-9, KAN-10, KAN-11 runs](agentic-workflows/functional-testing/runs)
  and the resulting [Playwright specs](apps/web/e2e).

### 2. Defect management and test management integration
- Jira integration via MCP: ISTQB-structured bug reports ([`report-jira-bug`](.agents/skills/report-jira-bug)).
- Full defect lifecycle exercise: seeded a bug, verified it on the deployed app, fixed it, re-verified after deploy
  ([patches](01-introduce-bug-FM-BUG-07.patch)).
- Qase integration via MCP: generated test cases and published test runs with results.
- Credential management for the external integrations (secrets kept out of the repo and agent context).

### 3. AI agents in CI/CD
GitHub Actions workflows ([`.github/workflows`](.github/workflows)) used as merge gates:
- Claude PR code review, test review against ISTQB criteria, and an implementation-vs-Jira comparison.
- **Mutation testing** to measure whether tests actually catch faults.
- **Selection-based testing** ([`select-tests`](.agents/skills/select-tests)): runs only the tests a PR needs,
  with a judge subagent that checks the selection for gaps.

### 4. Triage and issue automation
- Root-cause [triage workflow](.agents/skills/triage-pipeline): takes one reported problem from any
  source — free-text description, a Jira ticket, a GlitchTip issue, or a finding from the testing
  pipeline. It confirms the problem with a human, then worker subagents reproduce it in a browser and
  pull logs (Loki), metrics (Prometheus) and error events (GlitchTip). Each candidate cause is rated
  against the evidence, a read-only judge checks the report, and the result goes back to Jira only after approval.
  Black-box — it never changes code ([runs](agentic-workflows/triage/runs)).
- Scheduled autofix workflow ([`glitchtip-autofix.yml`](.github/workflows/glitchtip-autofix.yml)):
  picks an unresolved GlitchTip issue, files a Jira ticket, fixes it with a regression test and opens a
  guarded PR linked to the ticket — never auto-merged.

### 5. Guardrails
- [Hooks](.agents/hooks) that block flaky `waitForTimeout` patterns in tests and stop commits that contain secrets.
- Project rules that tell agents what not to "clean up" ([`.agents/rules`](.agents/rules)).
- Flaky-test exercise: fixed using real UI signals instead of timers, verified by repeated runs.

## Tools and technologies
| Area | Tools |
|---|---|
| AI agents | Claude Code — skills, subagents, hooks, MCP, human-in-the-loop review |
| Test automation | Playwright, JUnit 5 |
| Test & defect management | Jira, Qase |
| CI/CD | GitHub Actions, Docker, Render |
| Observability | GlitchTip (Sentry), Grafana, Prometheus, Loki |
| Practices | ISTQB test process, regression, functional, mutation and selection-based testing, defect triage |

## Setup
See [SETUP.md](SETUP.md) to deploy the app and monitoring stack and to connect the integrations.

## Notes
A course project for hands-on learning. Workflows are documented inside the repository.
