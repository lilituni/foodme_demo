---
name: automate-test-cases
description: Turn test cases from an existing docs/test-cases/<flow>.md file (produced by the generate-test-cases skill) into real automated tests — Playwright specs for frontend flows, JUnit for backend logic. Use when the user asks to automate, implement, or write code for test cases from a test plan. Requires a matching docs/test-cases file to already exist; does not invent test cases standalone.
---

# Automate test cases

This skill only automates cases that already exist in a
`docs/test-cases/<flow>.md` file written by the `generate-test-cases`
skill. It does not invent new test cases on its own.

## Step 1 — Require an existing test-case file

Determine which flow the user means and look for
`docs/test-cases/<flow-name>.md`. If it doesn't exist, **stop** and tell
the user to run `generate-test-cases` for that flow first — do not
improvise test cases from scratch as a fallback.

## Step 2 — Select which cases to automate

Read the file's table. If the user named specific case IDs, use those.
Otherwise, default to every row currently marked `Automated? No` (skip
rows already marked `Yes` — don't duplicate existing coverage).

## Step 3 — Classify each case: frontend or backend

For each selected case, decide which stack it belongs to based on what
it's actually testing:

- User-facing interaction (clicking, forms, cart, navigation) →
  **frontend**, Playwright.
- Server-side logic, validation, persistence, or an API contract directly
  → **backend**, JUnit.

A case can need both (e.g. "adding item updates cart AND persists
correctly") — split it into a frontend assertion and a backend assertion
if that's genuinely what it's testing; don't force a UI-only case into a
backend test or vice versa.

## Step 4 — Write frontend cases (Playwright, TypeScript)

Target `apps/web/e2e/*.spec.ts` for customer-storefront flows or
`apps/admin/e2e/*.spec.ts` for back-office flows. Match existing
conventions exactly:

- Reuse `apps/web/e2e/auth.ts` for any login/auth setup rather than
  reimplementing it.
- Reuse existing locator patterns already used in that app's specs (e.g.
  `a.cc_card`, `button.dc_card`, `aside.uc-panel .cic_root` in
  `apps/web/e2e` — check the actual existing specs for the current app
  before inventing new selectors).
- **Never use `page.waitForTimeout(ms)`.** Wait on real signals via
  Playwright's auto-waiting locators and `expect(...)` matchers — see
  @.agents/rules/flaky-tests.md for why and what the correct pattern looks
  like.
- Prefer adding a `test(...)` to an existing relevant `.spec.ts` file over
  creating a new file, unless the case belongs to a flow with no existing
  spec file yet.

## Step 5 — Write backend cases (JUnit 5, Java)

Target `apps/backend/src/test/java/am/foodme/backend/`. Match the existing
convention (see any `*ControllerTest.java` there):

```java
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SomeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void methodUnderTest_expectedBehavior() throws Exception {
        mockMvc.perform(get("/api/..."))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.field").value(...));
    }
}
```

- Test class per controller (`<Controller>Test.java`), flat in the base
  `am.foodme.backend` package, matching the existing files.
- Method naming: `<methodOrScenario>_<expectedOutcome>`.
- Respect @.agents/rules/backend-package-boundaries.md — a test for an
  admin endpoint belongs with the admin controller test, not merged into a
  customer-facing one.
- Don't touch Flyway migrations to set up test fixtures — see
  @.agents/rules/migrations-are-append-only.md; use whatever seeding
  mechanism the existing tests already rely on (check `application-test.properties`
  and existing test classes for how test data is provisioned).

## Step 6 — Update the test-case doc

After writing each test, update its row in `docs/test-cases/<flow>.md`:
change `Automated? No` to `Automated? Yes — <file>::<test method name>`,
keeping the doc in sync with the code so it stays trustworthy as a source
of truth for what's actually covered.

## Step 7 — Report

Summarize what was created/updated: which test cases, which files
(new vs. appended to), and confirm the test-case doc was updated to
match. Don't claim a case is automated if you only partially covered it —
say so explicitly if a case needs both a frontend and backend test and you
only wrote one side.
