# Observability instrumentation must survive refactors

Monitoring is a core subject of this project (see `infra/monitoring/`,
`render-monitoring.yaml`), not incidental plumbing. When touching backend
code, don't strip or weaken the following as a side effect of an unrelated
change or "cleanup":

## Prometheus metrics

```properties
management.endpoints.web.exposure.include=health,info,prometheus
management.metrics.distribution.percentiles-histogram.http.server.requests=true
```

Grafana dashboards and the workshop's own verification step (`up{app="foodme-backend"}`
in the README) depend on the `prometheus` actuator endpoint staying exposed
and on per-request histogram buckets staying enabled (needed to compute
p95/p99 latency). Narrowing `management.endpoints.web.exposure.include` or
removing the histogram property breaks those dashboards silently — they'll
just show gaps or "No data," not an error.

## Sentry/GlitchTip error reporting

Wired in `apps/backend/src/main/resources/logback-spring.xml` as a logback
appender at `ERROR` threshold, plus `apps/backend/src/main/java/.../controller/api/DebugController.java`
(`GET /api/debug/boom`) as its manual test trigger. Both frontends
(`apps/web`, `apps/admin`) also report via `@sentry/react`. Don't remove
the `SENTRY` appender, raise its threshold above `ERROR`, or delete
`DebugController` without being asked.

## Loki log shipping — a non-obvious constraint

`logback-spring.xml` conditionally adds a Loki appender when
`LOKI_PUSH_URL` is set, using a logback `<if>` block. There's a load-bearing
comment directly above it in that file:

> logback 1.5.8+ (Spring Boot 3.3.x) only honours `<if>` as a DIRECT child
> of `<configuration>`. Nesting it inside `<springProfile>`, `<appender>`
> or `<root>` makes Joran abort the surrounding element, which silently
> dropped ALL log output (console and Loki alike).

In other words: this was already tried the "natural" way (nesting the
conditional inside the profile-specific appender block) and it broke
**all** logging, not just Loki shipping — silently, no startup error. If
you ever touch `logback-spring.xml`, keep the `<if>` block as a top-level
child of `<configuration>`, exactly as it is now.

## Rule

- Don't narrow actuator/Prometheus exposure or remove the latency
  histogram property.
- Don't remove or weaken the Sentry appender or `DebugController`.
- Don't move the Loki `<if>` block out of the top level of
  `logback-spring.xml` — it will silently kill all logging, not just Loki.
- If a change requires touching any of the above, call it out explicitly
  rather than folding it into an unrelated diff.
