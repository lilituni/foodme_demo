# Backend package boundaries

`apps/backend/src/main/java/am/foodme/backend/` is organized by
responsibility, not by feature:

```
config/             Spring configuration (security, CORS, beans)
controller/admin/    Admin/back-office endpoints (AdminAuthController, AdminChefController, AdminDishController, AdminOrderController)
controller/api/      Customer-facing endpoints (ChefController, CustomerAuthController, CustomerController, DishController, ImageController, OrderController, DebugController)
dto/                 Request/response payloads
exceptionHandler/    @ControllerAdvice-style centralized error handling
model/               JPA entities
observability/       Metrics/logging support code
repository/          Spring Data repositories
security/            JWT/auth filters and config
service/             Business logic
utils/               Shared helpers
```

## `controller/admin` vs `controller/api` must stay separate

These two packages represent **two different authentication flows** —
`AdminAuthController` for the back-office (served at `/backoffice` by the
`admin` frontend) and `CustomerAuthController` for the storefront (served
at `/` by the `web` frontend). They intentionally have separate controllers
even where the underlying resource overlaps (e.g. dishes/orders exist in
both). Don't merge them into a single controller "to reduce duplication" —
that would blur a real security boundary between customer-scoped and
admin-scoped access.

## `DebugController`

`controller/api/DebugController` exposes a single endpoint, `GET
/api/debug/boom`, whose only job is to throw a `RuntimeException` on
purpose. It's a manual test harness for verifying Sentry/GlitchTip error
reporting actually reaches the dashboard — not dead code, not an
accidental leftover. Leave it in place unless explicitly asked to remove
it.

## Rule

- Add new customer-facing endpoints to `controller/api`, new back-office
  endpoints to `controller/admin` — never both from one controller class.
- Keep the layering intact: controllers call services, services call
  repositories; don't reach into `repository/` directly from a controller,
  and don't put business logic in `dto/` or `model/`.
- Don't relocate `DebugController` or repurpose its endpoint for anything
  other than deliberately triggering a test error.
