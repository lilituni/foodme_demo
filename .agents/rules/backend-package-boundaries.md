# Backend package boundaries

`apps/backend/src/main/java/am/foodme/backend/` is organized **by layer**
(all controllers together, all services together, etc.), not by feature —
so `ChefController`, `DishController`, and `OrderController` all live in
the same `controller/api/` package rather than each having its own
`chef/`, `dish/`, `order/` folder:

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
a merged controller would have to handle both admin and customer JWTs in
one place, making it easy to accidentally let a customer token reach an
admin-only action. Keeping them separate means which auth applies is
obvious just from which package a file is in.

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
  and don't put business logic in `dto/` or `model/`. Business rules (e.g.
  minimum order quantity) live in `service/` — if a controller bypasses
  the service and queries `repository/` directly, that rule silently
  doesn't apply to that code path.
- Don't relocate `DebugController` or repurpose its endpoint for anything
  other than deliberately triggering a test error.
