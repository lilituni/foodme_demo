# Secrets and environment variables

## Never hardcode a real secret

No Sentry/GlitchTip DSN, database password, JWT signing key, or API key
should ever be committed as a literal value for a real deployment. Secrets
flow through environment variables, referenced in
`apps/backend/src/main/resources/application.properties` as
`${ENV_VAR:default}` (e.g. `sentry.dsn=${SENTRY_DSN:}`,
`spring.datasource.password=${DB_PASSWORD:foodme}`) and, in Render, marked
`sync: false` in `render.yaml` so they're entered manually per deployment
rather than committed.

## Known existing exception — don't copy this pattern

Two values in `application.properties` are **hardcoded with no environment
override at all**, which is a known limitation of this teaching sandbox,
not a pattern to repeat:

```properties
foodme.jwt.secret=foodme-super-secret-signing-key-change-me
foodme.internal.api-key=fm_internal_9c1a7e2b3d4f4a5c8e6d1b2a3c4d5e6f
```

Every deployment of this project currently shares the same JWT signing key
and internal API key. Don't treat this as "how secrets work here" and
hardcode a new one the same way — any *new* secret you introduce must go
through an environment variable with no committed real value, following
the existing `${ENV_VAR:default-for-local-only}` convention (and the
default, if any, must be an obviously-fake placeholder, not something that
would work in production). Don't silently rotate or remove the two
existing hardcoded values either — that's a deliberate change outside a
"don't hardcode secrets" task and would need to be called out on its own.

## `.env.example` must stay in sync

`.env.example` (repo root) documents every environment variable consumed
across `infra/docker-compose.yml`'s profiles (`core`, `observability`,
`ci`) for backend, web, admin, and the monitoring stack. Whenever you add
a new environment variable anywhere in the stack, add a corresponding
(empty or placeholder) entry to `.env.example` in the same section style,
with a comment explaining what it's for — don't leave it undocumented.

## Rule

- No real secret values in code, config, migrations, or commit history.
- New secrets: environment-variable-driven, never hardcoded, and reflected
  in `.env.example`.
- Don't "fix" the two existing hardcoded values in
  `application.properties` unless explicitly asked to.
