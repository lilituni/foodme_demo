# Secrets and environment variables

Blocking an actual secret from being committed is handled mechanically by
the `PreToolUse` hook at `.agents/hooks/check-secrets.sh` (see
`.agents/settings.json`) — not duplicated here. This file covers the parts
a commit-time pattern scan can't catch: judgment calls about *how* to add
a new secret correctly, and keeping documentation in sync.

## Known existing exception — don't copy this pattern

Two values in `apps/backend/src/main/resources/application.properties`
are hardcoded with no environment override at all, which the hook
deliberately whitelists (they're pre-existing, not new) rather than
flagging on every commit:

```properties
foodme.jwt.secret=foodme-super-secret-signing-key-change-me
foodme.internal.api-key=fm_internal_9c1a7e2b3d4f4a5c8e6d1b2a3c4d5e6f
```

Every deployment of this project currently shares the same JWT signing key
and internal API key — a known limitation of this teaching sandbox, not a
pattern to repeat. The hook not flagging these two specific values doesn't
mean "hardcoding is fine here" — it only means these two are already
known and accepted. Any **new** secret you introduce must go through an
environment variable with no committed real value, following the existing
`${ENV_VAR:default-for-local-only}` convention (and the default, if any,
must be an obviously-fake placeholder, not something that would work in
production). Don't silently rotate or remove the two existing hardcoded
values either — that's a deliberate change outside a "don't hardcode
secrets" task and would need to be called out on its own.

## `.env.example` must stay in sync

`.env.example` (repo root) documents every environment variable consumed
across `infra/docker-compose.yml`'s profiles (`core`, `observability`,
`ci`) for backend, web, admin, and the monitoring stack. Whenever you add
a new environment variable anywhere in the stack, add a corresponding
(empty or placeholder) entry to `.env.example` in the same section style,
with a comment explaining what it's for — don't leave it undocumented.
The hook has no way to check this; it's on you (or the agent) to remember.
