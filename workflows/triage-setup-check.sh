#!/usr/bin/env bash
# Setup check for the triage pipeline (.agents/skills/triage-pipeline).
# Prints OK / MISSING / FAIL per prerequisite - never a value or a token.
# Read-only: GET requests only, nothing is started or changed.
#
#   bash workflows/triage-setup-check.sh

cd "$(dirname "$0")/.." || exit 1

ok()   { printf '  OK       %s\n' "$1"; }
miss() { printf '  MISSING  %s  -> %s\n' "$1" "$2"; }
fail() { printf '  FAIL     %s  -> %s\n' "$1" "$2"; }

# Value of NAME from .env, or empty.
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r"' ; }

echo "1. .env values (non-secret)"
[ -f .env ] || miss ".env" "cp .env.example .env"
for n in FOODME_PROD_WEB_URL FOODME_PROD_API_URL MONITORING_URL GLITCHTIP_URL GLITCHTIP_ORG GLITCHTIP_PROJECTS; do
  if [ -n "$(env_get "$n")" ]; then ok "$n"; else miss "$n" "set it in .env (see .env.example, triage pipeline section)"; fi
done

echo "2. AgentSecrets (tokens - names only)"
if ! command -v agentsecrets >/dev/null 2>&1; then
  miss "agentsecrets CLI" "npm install -g @the-17/agentsecrets && agentsecrets login"
else
  keys=$(agentsecrets secret list 2>/dev/null)
  for k in GLITCHTIP_TOKEN GLITCHTIP_ORGANIZATION GLITCHTIP_BASE_URL GRAFANA_BASIC; do
    if printf '%s' "$keys" | grep -q "$k"; then ok "$k"; else miss "$k" "agentsecrets secret set $k=..."; fi
  done
  # Tokens are only injected into allowlisted domains.
  allow=$(agentsecrets workspace allowlist list 2>/dev/null)
  for n in GLITCHTIP_URL MONITORING_URL; do
    host=$(env_get "$n" | sed -E 's#^[a-z]+://##; s#[/:].*$##')
    [ -n "$host" ] || continue
    if printf '%s' "$allow" | grep -qF "$host"; then ok "allowlist: $host"
    else miss "allowlist: $host" "agentsecrets workspace allowlist add $host"; fi
  done
fi

echo "3. Local SUT (default --sut local)"
if curl -fsS -m 5 http://localhost:8081/actuator/health >/dev/null 2>&1; then ok "API http://localhost:8081"
else miss "local stack" "docker compose -f infra/docker-compose.yml --profile core up -d --build"; fi
if curl -fsS -m 5 -o /dev/null http://localhost:3000 2>/dev/null; then ok "storefront http://localhost:3000"
else miss "storefront http://localhost:3000" "same compose command"; fi

echo "4. Production observability (--sut prod)"
mon=$(env_get MONITORING_URL); mon=${mon%/}
if [ -z "$mon" ]; then
  miss "MONITORING_URL" "skipped Loki/Prometheus/Grafana checks"
else
  # Render free tier may be asleep: allow a slow first response.
  curl -fsS -m 60 -o /dev/null "$mon/loki/ready" 2>/dev/null && ok "Loki $mon/loki/" || fail "Loki" "is foodme-monitoring deployed and awake?"
  curl -fsS -m 30 -o /dev/null "$mon/prom/-/ready" 2>/dev/null && ok "Prometheus $mon/prom/" || fail "Prometheus" "check render-monitoring.yaml deploy"
  curl -fsS -m 30 -o /dev/null "$mon/api/health" 2>/dev/null && ok "Grafana $mon/" || fail "Grafana" "check render-monitoring.yaml deploy"
fi
api=$(env_get FOODME_PROD_API_URL); api=${api%/}
if [ -n "$api" ]; then
  curl -fsS -m 60 -o /dev/null "$api/actuator/health" 2>/dev/null && ok "prod API $api" || fail "prod API" "Render service asleep or URL wrong"
fi

echo "5. GlitchTip API (via AgentSecrets, token never shown)"
gt=$(env_get GLITCHTIP_URL); gt=${gt%/}; org=$(env_get GLITCHTIP_ORG)
if [ -z "$gt" ] || [ -z "$org" ] || ! command -v agentsecrets >/dev/null 2>&1; then
  miss "GlitchTip check" "needs GLITCHTIP_URL, GLITCHTIP_ORG and agentsecrets"
else
  out=$(agentsecrets call --bearer GLITCHTIP_TOKEN --url "$gt/api/0/organizations/$org/projects/" 2>&1)
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q '"slug"'; then ok "GlitchTip $gt (org $org)"
  else fail "GlitchTip" "token missing/invalid or wrong org slug"; fi
fi

echo "6. MCP servers (.mcp.json)"
if cmp -s .mcp.json .agents/mcp.json; then ok ".mcp.json matches .agents/mcp.json"
else miss ".mcp.json in sync" "cp .agents/mcp.json .mcp.json, then restart Claude Code"; fi
if [ -n "$GRAFANA_MCP_URL" ]; then ok "GRAFANA_MCP_URL (user environment)"
else miss "GRAFANA_MCP_URL" "setx GRAFANA_MCP_URL https://<monitoring host>/mcp, then restart Claude Code"; fi

echo "7. Jira (Atlassian MCP) - can't be checked from a shell"
echo "  CHECK    in Claude Code: the Atlassian connector (claude.ai) must be connected;"
echo "           the local mcp-atlassian server is read-only and can't write back."
