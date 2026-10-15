import { test, expect, devices, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { createAccountAtCheckout, registerCustomerViaApi } from "./auth";

// KAN-10 Order again - storefront (KAN-16).
const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";

// Checkout re-fetches the chef menu, so a patched route can still be in flight
// when a test finishes; drop it quietly instead of failing the worker.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

interface MenuDish {
  id: number;
  nameEn: string;
  price: number;
  status: string;
  additions?: { id: number; nameEn: string; price: number }[];
}
interface OrderLine {
  nameEn: string;
  quantity: number;
}

async function checkoutLine(page: Page, name: string) {
  return page.locator(".cs_wrap .grid").filter({ has: page.getByText(name, { exact: true }) });
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${next}`);
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("secret123");
  await form.getByRole("button", { name: "Sign in" }).click();
}

/** A chef with at least two active dishes, the first of which has an extra. */
async function findChefWithExtras(request: APIRequestContext) {
  const chefs = await (await request.get(`${API}/api/chef/active?page=0&size=50`)).json();
  for (const chef of chefs.exploreChefResponseDtoList) {
    const detail = await (await request.get(`${API}/api/chef/${chef.id}`)).json();
    const active: MenuDish[] = (detail.dishes ?? []).filter((d: MenuDish) => d.status === "ACTIVE");
    const withExtra = active.find((d) => d.additions && d.additions.length > 0);
    const other = active.find((d) => d !== withExtra);
    if (withExtra && other) {
      return { chefId: chef.id as number, withExtra, other, otherChefId: undefined as number | undefined };
    }
  }
  throw new Error("No chef with two active dishes and an extra in the seed data");
}

async function placeOrderViaApi(
  request: APIRequestContext,
  token: string,
  chefId: number,
  lines: { dishId: number; quantity: number; additionIds?: number[] }[],
) {
  const res = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      chefId,
      receiverName: "Reorder E2E",
      receiverPhoneNumber: "+37495555777",
      receiverEmail: "reorder-e2e@example.com",
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note: "",
      createOrderDishes: lines.map((l) => ({
        dishId: l.dishId,
        quantity: l.quantity,
        additions: (l.additionIds ?? []).map((additionId) => ({ additionId })),
      })),
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).number as string;
}

/** Serve the chef's menu with a change applied - the "menu changed since you ordered" cases. */
async function patchMenu(page: Page, chefId: number, patch: (dishes: MenuDish[]) => void) {
  await page.route(`**/api/chef/${chefId}`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    patch(json.dishes);
    await route.fulfill({ response, json });
  });
}

async function addDishFromAnotherChef(page: Page, request: APIRequestContext, notChefId: number) {
  const chefs = await (await request.get(`${API}/api/chef/active?page=0&size=50`)).json();
  const other = chefs.exploreChefResponseDtoList.find((c: { id: number }) => c.id !== notChefId);
  await page.goto(`/chef/${other.id}`);
  await page.locator("button.dc_card").first().click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.locator("aside.uc-panel .cic_root")).toHaveCount(1);
}

// Only viewport/touch/UA - a describe-level test.use() can't switch browser type.
const { defaultBrowserType: _d, ...desktop } = devices["Desktop Chrome"];
const { defaultBrowserType: _m, ...mobile } = devices["Pixel 7"];

for (const vp of [
  { name: "desktop", use: desktop },
  { name: "mobile", use: mobile },
]) {
  test.describe(`order again (${vp.name})`, () => {
    test.use(vp.use);

    test("sign up -> order -> empty basket -> Order again -> checkout has same dishes and quantities", async ({
      page,
      request,
    }) => {
      await page.goto("/explore");
      await page.locator("a.cc_card").first().click();
      await expect(page).toHaveURL(/\/chef\/\d+/);

      const dishButtons = page.locator("button.dc_card");
      await dishButtons.nth(0).click();
      await page.getByRole("button", { name: "Add to cart" }).click();
      await dishButtons.nth(1).click();
      await page.getByRole("button", { name: "Add to cart" }).click();
      const cartPanel = page.locator("aside.uc-panel");
      await expect(cartPanel.locator(".cic_root")).toHaveCount(2);
      // Two of the first dish, so quantities are actually checked.
      await cartPanel.locator(".cic_root").first().getByRole("button", { name: "Increase quantity" }).click();
      await cartPanel.getByRole("link", { name: "Go to checkout" }).click();

      await createAccountAtCheckout(page, "Reorder Tester");
      const checkout = page.getByRole("form", { name: "Checkout" });
      await checkout.getByLabel("Full name").fill("Reorder Tester");
      await checkout.getByLabel("Phone").fill("+37491234567");
      await checkout.getByLabel("Email").fill("reorder@example.com");
      await page.getByLabel("City").fill("Yerevan");
      await page.getByLabel("Street").fill("Abovyan");
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(/\/orders\/success\?number=FM-\d+/);
      const number = new URL(page.url()).searchParams.get("number")!;
      const placed = await (await request.get(`${API}/api/order/number/${number}`)).json();
      const lines: OrderLine[] = placed.orderDishList;
      expect(lines.map((l) => l.quantity).sort()).toEqual([1, 2]);

      // The basket is empty after ordering.
      await page.goto("/checkout");
      await expect(page.getByRole("heading", { name: "Nothing to check out" })).toBeVisible();

      await page.goto("/orders");
      const card = page.getByRole("listitem").filter({ hasText: number });
      await card.getByRole("button", { name: "Order again" }).click();

      await expect(page).toHaveURL(/\/checkout$/);
      await expect(page.locator(".cs_wrap .grid")).toHaveCount(lines.length);
      for (const line of lines) {
        await expect(await checkoutLine(page, line.nameEn)).toContainText(`${line.quantity}×`);
      }
      await expect(page.getByRole("status")).toHaveCount(0);
    });
  });
}

test.describe("order again - menu changed since the order", () => {
  test("skips removed dishes (and says which), drops removed extras, uses today's price", async ({
    page,
    request,
  }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const { chefId, withExtra, other } = await findChefWithExtras(request);
    const extra = withExtra.additions![0];
    const number = await placeOrderViaApi(request, token, chefId, [
      { dishId: withExtra.id, quantity: 2, additionIds: [extra.id] },
      { dishId: other.id, quantity: 1 },
    ]);

    await patchMenu(page, chefId, (dishes) => {
      for (const d of dishes) {
        if (d.id === other.id) d.status = "INACTIVE"; // AC-2
        if (d.id === withExtra.id) {
          d.additions = d.additions!.filter((a) => a.id !== extra.id); // AC-3
          d.price = 1111; // AC-4
        }
      }
    });
    await signIn(page, email, "/orders");
    await page.getByRole("listitem").filter({ hasText: number }).getByRole("button", { name: "Order again" }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("status")).toHaveText(`1 item is no longer available: ${other.nameEn}.`);
    await expect(page.locator(".cs_wrap .grid")).toHaveCount(1);
    const line = await checkoutLine(page, withExtra.nameEn);
    await expect(line).toContainText("2×");
    await expect(line).not.toContainText(extra.nameEn);
    await expect(line).toContainText("2,222 AMD");
  });

  test("an extra that still exists is kept, at its current price", async ({ page, request }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const { chefId, withExtra } = await findChefWithExtras(request);
    const extra = withExtra.additions![0];
    const number = await placeOrderViaApi(request, token, chefId, [
      { dishId: withExtra.id, quantity: 1, additionIds: [extra.id] },
    ]);

    await patchMenu(page, chefId, (dishes) => {
      const d = dishes.find((x) => x.id === withExtra.id)!;
      d.price = 1000;
      d.additions!.find((a) => a.id === extra.id)!.price = 250;
    });
    await signIn(page, email, "/orders");
    await page.getByRole("listitem").filter({ hasText: number }).getByRole("button", { name: "Order again" }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    const line = await checkoutLine(page, withExtra.nameEn);
    await expect(line).toContainText(`+ ${extra.nameEn}`);
    await expect(line).toContainText("1,250 AMD");
  });

  test("nothing available: customer is told and the basket is untouched", async ({ page, request }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const { chefId, other } = await findChefWithExtras(request);
    const number = await placeOrderViaApi(request, token, chefId, [{ dishId: other.id, quantity: 1 }]);

    await addDishFromAnotherChef(page, request, chefId);
    await patchMenu(page, chefId, (dishes) => dishes.forEach((d) => (d.status = "INACTIVE")));
    await signIn(page, email, "/orders");

    const card = page.getByRole("listitem").filter({ hasText: number });
    await card.getByRole("button", { name: "Order again" }).click();

    await expect(card.getByRole("alert")).toHaveText("None of these dishes are available anymore");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("link", { name: "Cart, 1 items" })).toBeVisible();
  });
});

test.describe("order again - chef no longer available", () => {
  const chefStates: [string, (route: Route) => Promise<void>][] = [
    [
      "chef deactivated",
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), status: "INACTIVE" } });
      },
    ],
    ["chef deleted (404)", (route) => route.fulfill({ status: 404, json: { message: "Chef not found" } })],
  ];
  for (const [label, serveChef] of chefStates) {
    test(`${label}: customer is told and the basket is untouched`, async ({ page, request }) => {
      const { token, email } = await registerCustomerViaApi(request, API);
      const { chefId, other } = await findChefWithExtras(request);
      const number = await placeOrderViaApi(request, token, chefId, [{ dishId: other.id, quantity: 1 }]);

      await addDishFromAnotherChef(page, request, chefId);
      await page.route(`**/api/chef/${chefId}`, serveChef);
      await signIn(page, email, "/orders");

      const card = page.getByRole("listitem").filter({ hasText: number });
      await card.getByRole("button", { name: "Order again" }).click();

      await expect(card.getByRole("alert")).toHaveText("None of these dishes are available anymore");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/orders$/);
      await expect(page.getByRole("link", { name: "Cart, 1 items" })).toBeVisible();
    });
  }
});

test("a line from before KAN-10 (no dish reference) is named as no longer available", async ({ page, request }) => {
  const { token, email } = await registerCustomerViaApi(request, API);
  const { chefId, withExtra, other } = await findChefWithExtras(request);
  const number = await placeOrderViaApi(request, token, chefId, [
    { dishId: withExtra.id, quantity: 1 },
    { dishId: other.id, quantity: 2 },
  ]);

  // Serve the history as it looks for an old order: one line has no dishId.
  await page.route("**/api/customer/orders?**", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const order = json.list.find((o: { number: string }) => o.number === number);
    if (order) {
      const legacy = order.orderDishList.find((l: { nameEn: string }) => l.nameEn === withExtra.nameEn);
      delete legacy.dishId;
    }
    await route.fulfill({ response, json });
  });
  await signIn(page, email, "/orders");
  await page.getByRole("listitem").filter({ hasText: number }).getByRole("button", { name: "Order again" }).click();

  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("status")).toHaveText(`1 item is no longer available: ${withExtra.nameEn}.`);
  await expect(page.locator(".cs_wrap .grid")).toHaveCount(1);
  await expect(await checkoutLine(page, other.nameEn)).toContainText("2×");
});

test.describe("order again - basket from a different chef", () => {
  test("asks first; No keeps the basket, Yes replaces it", async ({ page, request }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const { chefId, other } = await findChefWithExtras(request);
    const number = await placeOrderViaApi(request, token, chefId, [{ dishId: other.id, quantity: 3 }]);

    await addDishFromAnotherChef(page, request, chefId);
    await signIn(page, email, "/orders");
    const card = page.getByRole("listitem").filter({ hasText: number });

    await card.getByRole("button", { name: "Order again" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Your basket has items from another chef. Replace them?")).toBeVisible();
    await dialog.getByRole("button", { name: "No" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("link", { name: "Cart, 1 items" })).toBeVisible();
    // The other chef's dish is still the only line, and nothing from the old order was added.
    await page.goto("/checkout");
    await expect(page.locator(".cs_wrap .grid")).toHaveCount(1);
    await expect(page.locator(".cs_wrap .grid").first()).toContainText("1×");
    await expect(await checkoutLine(page, other.nameEn)).toHaveCount(0);

    await page.goto("/orders");
    await card.getByRole("button", { name: "Order again" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, replace" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.locator(".cs_wrap .grid")).toHaveCount(1);
    await expect(await checkoutLine(page, other.nameEn)).toContainText("3×");
  });
});

test("while rebuilding, the button shows loading and can't be pressed twice", async ({ page, request }) => {
  const { token, email } = await registerCustomerViaApi(request, API);
  const { chefId, other } = await findChefWithExtras(request);
  const number = await placeOrderViaApi(request, token, chefId, [{ dishId: other.id, quantity: 2 }]);

  // Hold the menu request until we've checked the loading state.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/chef/${chefId}`, async (route) => {
    await held;
    await route.continue();
  });
  await signIn(page, email, "/orders");
  const card = page.getByRole("listitem").filter({ hasText: number });
  await card.getByRole("button", { name: "Order again" }).click();

  const loading = card.getByRole("button", { name: "Adding to basket…" });
  await expect(loading).toBeDisabled();
  await loading.click({ force: true }); // a second press must not add the dishes twice
  release();

  await expect(page).toHaveURL(/\/checkout$/);
  await expect(await checkoutLine(page, other.nameEn)).toContainText("2×");
});

test("tracking page offers Order again only when signed in", async ({ page, request }) => {
  const { token, email } = await registerCustomerViaApi(request, API);
  const { chefId, other } = await findChefWithExtras(request);
  const number = await placeOrderViaApi(request, token, chefId, [{ dishId: other.id, quantity: 1 }]);

  await page.goto(`/tracking/${number}`);
  await expect(page.getByText("Order received")).toBeVisible();
  await expect(page.getByRole("button", { name: "Order again" })).toHaveCount(0);

  await signIn(page, email, `/tracking/${number}`);
  await page.getByRole("button", { name: "Order again" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(await checkoutLine(page, other.nameEn)).toContainText("1×");
});
