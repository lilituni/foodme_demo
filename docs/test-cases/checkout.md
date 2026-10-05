# Test cases — Checkout flow

Covers adding items to cart (`apps/web/src/hooks/useCart.ts`), order
placement (`controller/api/OrderController`, `service/OrderService.java`),
and delivery pricing. Several cases below specifically target lines in
`OrderService.java` flagged with seeded-bug ticket comments
(`FM-BUG-01`, `FM-BUG-03`, `FM-BUG-05`, `FM-BUG-06`) that appear not yet
fixed — these describe the *correct* expected behavior, which may or may
not currently hold; that's the point of writing them down.

| ID | Title | Type | Preconditions | Steps | Expected Result | Priority | Automated? |
|----|-------|------|----------------|-------|------------------|----------|------------|
| CHK-01 | Adding dishes to cart updates subtotal and item count | Functional | Customer on a chef's page | Add 2 different dishes to cart | Cart subtotal = sum of dish prices; item count = 2 | High | Yes — `apps/web/e2e/happy-path.spec.ts::"explore -> chef -> add 2 dishes -> cart total -> cash checkout -> success"` |
| CHK-02 | Dish additions raise the cart line price | Functional | Dish has selectable additions | Open dish modal, select an addition, add to cart | Cart line price = dish price + addition price | Medium | Yes — `apps/web/e2e/happy-path.spec.ts::"dish modal additions raise cart line price"` |
| CHK-03 | Cart survives a page reload right after adding an item | Edge | Item just added to cart | Reload the page immediately | Cart still shows the item (persisted via IndexedDB before reload completes) | High | Yes — `apps/web/e2e/flake-cart-persistence.spec.ts` (`FM-FLAKE-05`, fixed) |
| CHK-04 | Decrementing an item at its minimum quantity removes it instead of going below the minimum | Edge / Boundary | Cart item at `quantity == minQuantity` (dish's `minimumOrderCount`) | Click decrement | Item is removed from cart entirely, never shows a quantity below `minQuantity` | High | Yes — `apps/web/e2e/storefront-flows.spec.ts::"decrementing cart item at minimum quantity removes it"` |
| CHK-05 | Adding a dish from a different chef than what's already in the cart is not silently mixed in | Negative / Edge | Cart has an item from chef A | Add a dish from chef B without confirming a replace | `addDishToCart` returns `"mismatch"`; cart still only contains chef A's item unless the user explicitly confirms replacing it | High | Yes — `apps/web/e2e/storefront-flows.spec.ts::"adding a dish from a different chef prompts to switch kitchens"` |
| CHK-06 | Cash checkout succeeds and the order appears in the customer's order list | Functional | Authenticated customer, non-empty cart | Submit checkout with `paymentType: CASH` | 200 response, `status: "NEW"`, order number returned; order appears in `GET /api/customer/orders` | High | Yes — `OrderControllerTest::createOrder_cashPayment_succeeds` |
| CHK-07 | Checkout without an auth token is rejected | Auth | No/invalid token | `POST /api/order` with a valid cash payload, no `Authorization` header | 401 Unauthorized | High | Yes — `OrderControllerTest::createOrder_withoutToken_unauthorized` |
| CHK-08 | Non-cash payment type is rejected with a clear error | Negative | Authenticated customer | `POST /api/order` with `paymentType: CARD` | 400 Bad Request, message `"Only CASH payment is supported"` | Medium | Yes — `OrderControllerTest::createOrder_nonCashPayment_rejectedWithBadRequest` |
| CHK-09 | Takeaway checkout succeeds without a delivery address | Functional / Edge | `deliveryMethod: TAKEAWAY`, no address provided | Submit checkout | Order created successfully; no address required | Medium | Yes — `apps/web/e2e/happy-path.spec.ts::"takeaway checkout succeeds without address"` |
| CHK-10 | Delivery is free when subtotal exactly equals the chef's free-delivery threshold | Edge / Boundary | Chef has `freeDeliveryFrom` set, delivery method `DELIVERY` | Checkout with `subtotal == freeDeliveryFrom` exactly | Delivery price = 0.0 | High | Yes — `OrderControllerTest::deliveryPrice_subtotalEqualsFreeThreshold_isFree` (targets `FM-BUG-03`) |
| CHK-11 | Order total correctly reflects fractional dish prices without truncating cents | Functional / Data correctness | A dish priced with cents (e.g. 2.50), ordered at a quantity that produces a fractional subtotal (e.g. qty 3 → 7.50) | Checkout, inspect returned `totalPrice` | Subtotal reflects the full fractional amount, no lost cents | High | Yes — `OrderControllerTest::createOrder_fractionalDishPrice_subtotalKeepsCents` (targets `FM-BUG-01`; added dish id 5 to `data.sql` priced 1500.33 specifically to exercise this) |
| CHK-12 | Ordering a dish that doesn't belong to the order's chef is rejected | Negative / Security | Order's `chefId` = A, `createOrderDishes` includes a `dishId` that actually belongs to chef B | Submit checkout | Request is rejected (400/404), not silently accepted as if it belonged to chef A | High | Yes — `OrderControllerTest::createOrder_dishFromDifferentChef_isRejected` (targets `FM-BUG-05`) |
| CHK-13 | Order's `createdAt` is stored/returned consistently regardless of server/client timezone | Edge / Data correctness | Any valid checkout | Create an order, inspect `createdAt` | Timestamp reflects true UTC order time, not shifted by local server timezone | Medium | Partially — `OrderControllerTest::createOrder_createdAtFallsOnToday` (`FM-FLAKE-04`) only checks the date-string prefix matches `LocalDate.now()`, which doesn't actually verify UTC-correctness and is itself flaky near midnight/across timezones; root cause likely `LocalDateTime.now()` without an explicit zone in `OrderService.createOrder` (`FM-BUG-06`). Left as a gap — a true fix needs a real UTC assertion, not just automating the existing weak one. |
| CHK-14 | Ordering a dish id that doesn't exist returns 404 | Negative | `createOrderDishes` includes a non-existent `dishId` | Submit checkout | 404 Not Found, message identifies the missing dish id | Medium | Yes — `OrderControllerTest::createOrder_nonexistentDish_returns404` |
| CHK-15 | Admin can see a newly placed customer order | Functional / Cross-role | Admin account exists | Customer completes checkout, admin logs in and views orders | New order appears in the admin order list | Medium | Yes — `apps/web/e2e/happy-path.spec.ts::"admin can login and list orders after a storefront checkout"` |

## Coverage summary

- 15 cases: 13 automated, 1 partially automated (and itself flaky), 1 gap
  remaining (CHK-13, which needs a real UTC assertion, not just automating
  the existing weak check).
- CHK-10, CHK-11, CHK-12 target `FM-BUG-03`, `FM-BUG-01`, `FM-BUG-05`
  directly and are expected to currently **fail** against the app's
  present behavior — that's intentional, they document correct behavior,
  not confirmed-passing behavior. Not yet executed in this environment (no
  JDK/Docker available here) — run `./gradlew test --tests OrderControllerTest`
  or let CI confirm.
- CHK-11 required adding a fractional-priced dish (id 5, chef 2) to the
  test-only seed (`apps/backend/src/test/resources/data.sql`, not a Flyway
  migration) since all existing seeded dish prices are whole numbers and
  wouldn't exercise the truncation bug. First attempt put it under chef 1
  and broke `DishControllerTest`'s exact-count assertion for chef 1's
  active dishes - moved to chef 2, which has no such assertion.
