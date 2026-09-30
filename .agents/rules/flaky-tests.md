# Flaky test files — do not "fix" without being asked

`apps/web/e2e/flake-dish-modal.spec.ts` (ticket `FM-FLAKE-01`) is
**intentionally flaky** and exists as a live teaching exercise:

```ts
await dishButton.click();

// FM-FLAKE-01
await page.waitForTimeout(300);

await page.getByRole("button", { name: "Add to cart" }).click();
```

This is the classic **arbitrary-timeout anti-pattern**: instead of waiting
for the actual condition that matters (the "Add to cart" button being
rendered and interactable after the dish modal opens), it waits a fixed
300ms and hopes that's enough. Most of the time it is — which is exactly
what makes it flaky rather than reliably broken:

- On a slower CI runner, under load, or if the modal's open
  animation/transition takes longer than usual, 300ms elapses before the
  button is actually ready, the click misses, and the test fails.
- The failure is **non-deterministic** — same code, same test, different
  outcome on different runs — which is what distinguishes a flaky test from
  a plain broken one.

## What "fixed" looks like (already demonstrated in this repo)

`apps/web/e2e/flake-cart-persistence.spec.ts` (ticket `FM-FLAKE-05`) used to
have the same class of problem — it reloaded the page immediately after
"Add to cart," racing against the app actually persisting the cart to
IndexedDB (via Dexie) before the reload wiped in-memory state. It has
already been fixed, and the fix is left in place as the reference pattern:

```ts
// FM-FLAKE-05 FIX: Wait for cart panel to update before reloading
const cartPanel = page.locator("aside.uc-panel");
await expect(cartPanel.locator(".cic_root")).toHaveCount(1);

await page.reload();
```

Instead of a timer, it waits for the real, observable signal — the cart
panel actually showing the item — before doing the next action. Playwright's
`expect(...).toHaveCount(...)` / `toBeVisible()` auto-retry until the
condition is true (or a timeout is hit), which is what makes this reliable
instead of lucky.

## Rule

**Do not modify `flake-dish-modal.spec.ts` to remove its flakiness unless
explicitly asked to fix a flaky test.** It's a deliberate, open exercise —
silently patching it defeats the point of the course material.

If you *are* asked to fix it (or any other flaky wait you introduce or
encounter anywhere in `apps/web/e2e` or `apps/admin/e2e`), follow the
`FM-FLAKE-05` pattern: replace `page.waitForTimeout(ms)` with an assertion
on the actual UI/network/state signal you're waiting for, using
Playwright's built-in auto-waiting locators and `expect(...)` matchers
rather than a fixed delay.
