---
name: render-deploy-checklist
description: Walk through pre-deploy and post-deploy verification for FoodMe's Render blueprints (render.yaml, render-monitoring.yaml) — required env vars, cross-service wiring, and a live health/metrics/log check via Grafana. Use when the user is about to deploy to Render, just deployed, or asks whether their deploy / monitoring setup is correct.
---

# Render deploy checklist

Mirrors the manual steps in the root `README.md`, as a checklist instead of
free-text instructions. This skill cannot query Render's dashboard directly
(no API token) — the pre-deploy items must be confirmed by the user; the
post-deploy item can be checked for real if a monitoring URL is available.

## Step 1 — Confirm the fork is personalized

Check `render.yaml`'s `services[0].name`. If it's still a generic/example
name (not something the user has personalized), tell them to change it per
README Step 1 before deploying — Render derives the service URL from this.

## Step 2 — Pre-deploy: app blueprint (`render.yaml`)

Ask the user to confirm, one by one (don't assume — these live in Render's
dashboard, not in the repo):

- [ ] `SENTRY_DSN` — set to the GlitchTip **backend** project's DSN
- [ ] `VITE_SENTRY_DSN_WEB` — set to the GlitchTip **web** project's DSN
- [ ] `VITE_SENTRY_DSN_ADMIN` — set to the GlitchTip **admin** project's DSN
- [ ] `LOKI_PUSH_URL` — **must be empty** at this stage (monitoring doesn't
      exist yet); flag it as a problem if the user says it's already set

## Step 3 — Pre-deploy: monitoring blueprint (`render-monitoring.yaml`)

Only relevant once the app from Step 2 is Live. Confirm:

- [ ] Deployed via **Blueprint** using `render-monitoring.yaml` (not
      `render.yaml` again)
- [ ] `BACKEND_HOST` on `foodme-monitoring` is set to the app's host
      **without** `https://` (e.g. `foodme-<name>-xxxx.onrender.com`)
- [ ] `LOKI_PUSH_URL` back on the **app** service is set to
      `https://foodme-monitoring-xxxx.onrender.com/loki/api/v1/push`
      (the monitoring service's own public URL + `/loki/api/v1/push`)
- [ ] Both services show **Live** again after saving these (saving restarts
      them)

Common failure mode to check for: using the monitoring service's *private*
hostname instead of its public `*.onrender.com` URL for `LOKI_PUSH_URL` —
per the README, free Render web services can't receive private-network
traffic, so that silently never delivers logs.

## Step 4 — Post-deploy: live verification (can be automated)

Ask the user for their monitoring service's URL
(`https://foodme-monitoring-xxxx.onrender.com`). If Grafana MCP tools are
connected in this session, use them against that URL's `/mcp` endpoint —
no auth needed, per `infra/monitoring/README.md` — to actually run:

1. A Prometheus query: `up{app="foodme-backend"}` — expect the value `1`.
2. A Loki query: `{app="foodme-backend"}` — expect recent log lines.

If Grafana MCP tools aren't available in this session, tell the user to run
these two queries themselves in Grafana's **Explore** view (Prometheus and
Loki data sources respectively), same as README Step 5.

Note: free-tier services sleep after ~15 min idle and monitoring data is
wiped on every monitoring-service restart — a "down"/"no data" result right
after waking something up is expected, not necessarily a real problem.
Re-check after ~30 seconds before concluding something is actually broken.

## Step 5 — Report

Summarize as a pass/fail checklist across Steps 1–4, calling out anything
unconfirmed or failing, rather than a single "looks good" verdict.
