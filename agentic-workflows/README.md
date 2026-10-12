# Agentic workflows

Run outputs of the agent-driven test workflows. The workflows themselves are
skills and subagents in `.agents/skills/` and `.agents/agents/` (Claude Code only
discovers them there); this folder holds what each run produces.

| Workflow | Start with | Runs |
|---|---|---|
| Functional testing (ISTQB test process, steps 01–10) | `/feature-testing-pipeline <T>` | `functional-testing/runs/<T>/` |
| Bug triage (step 09, also usable on its own) | `/bug-triage <T>` | `bug-triage/runs/<id>/` |

Rule: **agents create, judges check (read-only), the human reviews and decides.**
Every human approval is recorded in the run's `gates.yaml`; nothing is filed in
Jira or pushed to Qase without one.

The Claude Code status line (`workflows/statusline.sh`, wired in
`.agents/settings.json`) shows the current run's progress, e.g.

```
Feature Testing KAN-11 │ ✅01 ▶02 ⏳03 ⏳04 ⏳05 ⏳06 ⏳07 ⏳08 ⏳09 ⏳10 │ 02 Test plan · writing plan
```

`✅` done · `▶` running · `🧑` waiting for you · `⛔` blocked · `⏳` not started
