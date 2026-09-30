---
name: generate-test-cases
description: Generate a structured QA test-case document (10-15 cases) for a FoodMe feature or user flow, saved under docs/test-cases/. Use when the user asks to generate, write, or suggest test cases for a specific flow (e.g. checkout, admin login, dish ordering) or for "the app" in general without naming one.
---

# Generate test cases

Produces a human-readable **test plan** (what to test, steps, expected
result) — not automated test code. To turn cases from this output into
actual Playwright/JUnit tests, use the separate `automate-test-cases`
skill, which requires the file this skill produces.

## Step 1 — Determine the target flow

If the user named a specific flow/feature/endpoint, use it. If they didn't,
pick the flow(s) yourself by looking at what the app actually does — e.g.
skim `README.md`, the customer routes in `apps/web/src`, the admin routes
in `apps/admin/src`, and the backend controllers in
`apps/backend/src/main/java/am/foodme/backend/controller/{api,admin}`.
Prefer a flow with real business logic (checkout/cart, ordering, auth) over
a trivial CRUD screen. State which flow you picked and why before
generating anything.

## Step 2 — Ground the cases in real behavior

Before inventing test cases, actually read the relevant code for the
chosen flow:

- Frontend: the relevant component(s)/hook(s) in `apps/web/src` or
  `apps/admin/src` — e.g. validation logic, conditional rendering, hooks
  like `useCart.ts`.
- Backend: the relevant controller (`controller/api` for customer-facing,
  `controller/admin` for back-office — see
  @.agents/rules/backend-package-boundaries.md), its DTOs, and any
  validation in the service layer.

Use what you find to write specific, real test cases (e.g. actual
boundary values, actual validation messages, actual auth requirements) —
not generic placeholders like "test invalid input."

## Step 3 — Check existing automated coverage

Search for existing automated tests that already exercise this flow:

- `apps/web/e2e/*.spec.ts` and `apps/admin/e2e/*.spec.ts` (Playwright)
- `apps/backend/src/test/java/am/foodme/backend/*Test.java` (JUnit,
  `@SpringBootTest` + `MockMvc` style — see any existing `*ControllerTest.java`
  for the pattern)

For each test case you generate in Step 4, note whether an existing
automated test already covers it (name the file/test method) or whether
it's a gap.

## Step 4 — Generate 10-15 test cases

Default to 10-15 unless the user asked for a different number. Cover a mix
of categories — don't produce 15 variations of the happy path:

- Functional / happy path
- Negative (invalid input, missing required fields)
- Edge / boundary (min/max quantities, empty states, pagination edges)
- Auth / permission (customer vs admin boundary, unauthenticated access)
- Error handling (backend failure, network failure, validation errors)

Format as a markdown table:

| ID | Title | Type | Preconditions | Steps | Expected Result | Priority | Automated? |
|----|-------|------|----------------|-------|------------------|----------|------------|

- `ID`: short stable id, e.g. `CHK-01`, `CHK-02` (prefix derived from the
  flow name).
- `Automated?`: `Yes — <file>::<test name>` or `No`.

## Step 5 — Save the file

Write to `docs/test-cases/<flow-name>.md` (kebab-case flow name, e.g.
`docs/test-cases/checkout.md`). Create the `docs/test-cases/` directory if
it doesn't exist. If the file already exists, regenerate/update it
(this is meant to be a living document per flow, not append-only) — tell
the user you're updating an existing file rather than creating a new one.

Give the file a short heading and one-sentence scope description above the
table, e.g.:

```markdown
# Test cases — Checkout flow

Covers adding items to cart, cart persistence, and order placement
(`apps/web/src/hooks/useCart.ts`, `controller/api/OrderController`).

| ID | Title | ... |
```

## Step 6 — Report

Summarize: which flow, how many cases, how many already automated vs
gaps, and the file path. Don't dump the full table into the chat reply if
it's already in the file — link to it instead.
