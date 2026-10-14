import { test, expect, devices, type APIRequestContext, type Page } from "@playwright/test";

// KAN-10 Order again: one test per approved test case (functional-testing
// workflow, step 06). The cases in runs/KAN-10/spec.yaml are the spec; every
// assertion checks the case's expected value word for word (`// expected[n]`).
// Lines marked `// sync:` only wait for the app to settle and check no case fact.
//
// TC-01 (needs a customer-cancelled order; this branch has no cancel), TC-06
// (no admin API to remove an extra) and TC-12 (admin chef update returns 500)
// are manual-only, see their `automation` blocks in spec.yaml.

const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";
const AUTH_KEY = "foodme.customer.auth";

// Chef 24 Alans Kitchen and its dishes, as in plan.md's test data.
const CHEF = 24;
const CRISPY_SALAD = 349;
const SWEET_CHILE = 476;
const BUKKAKE_UDON = 313;
const KAKE_UDON = 314;

type OrderDish = { dishId: number; quantity: number; additions?: { additionId: number }[] };
const O1: OrderDish[] = [
  { dishId: CRISPY_SALAD, quantity: 2, additions: [{ additionId: SWEET_CHILE }] },
  { dishId: BUKKAKE_UDON, quantity: 1 },
];
const O2: OrderDish[] = [
  { dishId: CRISPY_SALAD, quantity: 1 },
  { dishId: BUKKAKE_UDON, quantity: 1 },
  { dishId: KAKE_UDON, quantity: 1 },
];

// The admin changes below touch chef 24's shared menu, so this file's tests run
// one after another (not fully parallel) and every change is undone in `finally`.
test.describe.configure({ mode: "default" });

type Customer = { token: string; auth: string; email: string };

async function registerCustomer(request: APIRequestContext): Promise<Customer> {
  const email = `stlc-kan10-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { fullName: "STLC Tester", email, phoneNumber: "+37491000000", password: "secret123" },
  });
  expect(res.ok()).toBeTruthy(); // sync: account created
  const body = await res.json();
  return { token: body.token as string, auth: JSON.stringify(body), email };
}

/** Signs the page in as `customer` (or out, with null) through the app's own storage key. */
async function setSignedIn(page: Page, customer: Customer | null) {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate(
    ([key, value]) => (value ? localStorage.setItem(key, value) : localStorage.removeItem(key)),
    [AUTH_KEY, customer?.auth ?? null] as const,
  );
}

/** Places a takeaway order for chef 24 through the API (the case's precondition). */
async function placeOrder(request: APIRequestContext, customer: Customer, note: string, dishes: OrderDish[]) {
  const res = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${customer.token}` },
    data: {
      chefId: CHEF,
      receiverName: "STLC Tester",
      receiverPhoneNumber: "+37491000000",
      receiverEmail: customer.email,
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note,
      createOrderDishes: dishes,
    },
  });
  expect(res.ok()).toBeTruthy(); // sync: order placed
  return (await res.json()).number as string;
}

/** Back-office change to dishes (local seed admin), undone after `body` whatever happens. */
async function withDishChanges(
  request: APIRequestContext,
  changes: Record<number, Record<string, unknown>>,
  body: () => Promise<void>,
) {
  const login = await request.post(`${API}/admin/auth/login`, { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBeTruthy(); // sync: admin signed in
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const originals: Record<string, unknown>[] = [];
  try {
    for (const [id, change] of Object.entries(changes)) {
      const dish = await (await request.get(`${API}/admin/dish/${id}`, { headers })).json();
      originals.push(dish);
      const put = await request.put(`${API}/admin/dish/${id}`, { headers, data: { ...dish, ...change } });
      expect(put.ok()).toBeTruthy(); // sync: back-office change saved
    }
    await body();
  } finally {
    for (const dish of originals) {
      const back = await request.put(`${API}/admin/dish/${dish.id}`, { headers, data: dish });
      expect(back.ok()).toBeTruthy(); // sync: back-office change undone
    }
  }
}

/** Opens the dish on the chef page and adds 1 of it (no extras) to the cart. */
async function addDish(page: Page, chefId: number, name: string) {
  await page.goto(`/chef/${chefId}`);
  const cart = page.locator("aside.uc-panel");
  const linesBefore = await cart.locator(".cic_root").count();
  await page.locator("button.dc_card").filter({ has: page.getByText(name, { exact: true }) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Add to cart/ }).click();
  await expect(dialog).toBeHidden(); // sync: modal closes after adding
  await expect(cart.locator(".cic_root")).toHaveCount(linesBefore + 1); // sync: cart line saved (FM-FLAKE-05)
}

/** "The basket holds only 1 × <dish>, <price>": the chef page's cart panel (one line, quantity 1). */
async function expectBasketOnly(page: Page, chefId: number, name: string, price: string) {
  await page.goto(`/chef/${chefId}`);
  const lines = page.locator("aside.uc-panel .cic_root");
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText(name);
  await expect(lines.first().locator("p.font-bold.tabular-nums")).toHaveText("1"); // the quantity shown between - and +
  await expect(lines.first()).toContainText(price);
}

async function pressOrderAgain(page: Page) {
  await page.goto("/orders");
  await page.getByRole("button", { name: "Order again" }).click();
}

const REPLACE_QUESTION = "Your basket has items from another chef. Replace them?";

// Checkout: one row per basket line ("2×", name, "+ extras", line price).
const checkoutLine = (page: Page, name: string) =>
  page.locator(".cs_wrap div.grid").filter({ has: page.getByText(name, { exact: true }) });
const subtotal = (page: Page) =>
  page
    .locator("div.justify-between")
    .filter({ has: page.getByText("Subtotal", { exact: true }) })
    .first()
    .locator("span")
    .nth(1);

/** "Checkout lists <qty> × <name> [with <extra>]" */
async function expectLine(page: Page, qty: number, name: string, extra?: string) {
  const line = checkoutLine(page, name);
  await expect(line).toHaveCount(1);
  await expect(line.locator("span").first()).toHaveText(`${qty}×`);
  if (extra) await expect(line.getByText(`+ ${extra}`, { exact: true })).toBeVisible();
}

// KAN-10-TC-03, shared by the desktop and mobile tests.
async function tc03(page: Page, request: APIRequestContext) {
  const customer = await registerCustomer(request);
  await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-03 auto", O1);
  await setSignedIn(page, customer);

  await pressOrderAgain(page);

  await expect(page).toHaveURL(/\/checkout/); // expected[1]
  await expectLine(page, 2, "Crispy Salad", "Sweet Chile"); // expected[2]
  await expectLine(page, 1, "Bukkake Udon"); // expected[3]
  await expect(subtotal(page)).toHaveText("5,500 AMD"); // expected[4]
  // expected[5] "The same holds on mobile": the [mobile] test runs this same flow on Pixel 7.
}

// Pixel 7 (touch, mobile user agent) at the case's 375 × 812 viewport; without
// defaultBrowserType, which can't be set inside a describe group.
const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];
const mobile375 = { ...pixel7, viewport: { width: 375, height: 812 } };

test.describe("KAN-10 Order again - approved cases", () => {
  test("KAN-10-TC-02 Order tracking page: Order again only for the order's own signed-in customer", async ({ page, request }) => {
    test.fail(true, "KAN-25: KAN-10: \"Order again\" shown on another customer's order tracking page (Q-5 says own orders only)");
    const a = await registerCustomer(request);
    const b = await registerCustomer(request);
    const number = await placeOrder(request, a, "STLC KAN-10 KAN-10-TC-02 auto", O1);
    const orderAgain = page.getByRole("button", { name: "Order again" });

    await setSignedIn(page, a);
    await page.goto(`/tracking/${number}`);
    await expect(page.getByText(number).first()).toBeVisible(); // sync: tracking page loaded
    await expect(orderAgain).toBeVisible(); // expected[1]

    await setSignedIn(page, null);
    await page.goto(`/tracking/${number}`);
    await expect(page.getByText(number).first()).toBeVisible(); // sync: tracking page loaded
    await expect(orderAgain).toHaveCount(0); // expected[2]

    await setSignedIn(page, b);
    await page.goto(`/tracking/${number}`);
    await expect(page.getByText(number).first()).toBeVisible(); // sync: tracking page loaded
    await expect(orderAgain).toHaveCount(0); // expected[3]
  });

  test("KAN-10-TC-03 All dishes available: basket rebuilt with the same dishes, quantities and extras, then checkout", async ({ page, request }) => {
    await tc03(page, request);
  });

  test("KAN-10-TC-04 One dish no longer offered: it is skipped and named in the singular message", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-04 auto", O1);
    await setSignedIn(page, customer);

    await withDishChanges(request, { [BUKKAKE_UDON]: { status: "INACTIVE" } }, async () => {
      await pressOrderAgain(page);

      await expect(page.getByText("1 item is no longer available: Bukkake Udon.", { exact: true })).toBeVisible(); // expected[1]
      await expect(page).toHaveURL(/\/checkout/); // expected[2]
      // expected[3]: 2 × Crispy Salad with Sweet Chile and no Bukkake Udon
      await expectLine(page, 2, "Crispy Salad", "Sweet Chile");
      await expect(checkoutLine(page, "Bukkake Udon")).toHaveCount(0);
      await expect(subtotal(page)).toHaveText("4,000 AMD"); // expected[4]
    });
  });

  test("KAN-10-TC-05 Two dishes no longer offered: both skipped and named in the plural message", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-05 auto", O2);
    await setSignedIn(page, customer);

    await withDishChanges(request, { [BUKKAKE_UDON]: { status: "INACTIVE" }, [KAKE_UDON]: { status: "INACTIVE" } }, async () => {
      await pressOrderAgain(page);

      // expected[1]: the two names in either order (cases gate, J3 on TC-05)
      await expect(
        page.getByText(/^2 items are no longer available: (Bukkake Udon, Kake udon|Kake udon, Bukkake Udon)\.$/),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/checkout/); // expected[2]
      // expected[3]: only 1 × Crispy Salad
      await expect(page.locator(".cs_wrap div.grid")).toHaveCount(1);
      await expectLine(page, 1, "Crispy Salad");
      await expect(subtotal(page)).toHaveText("1,800 AMD"); // expected[4]
    });
  });

  test("KAN-10-TC-07 A price raised since the order: today's price is used", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-07 auto", O1);
    await setSignedIn(page, customer);

    await withDishChanges(request, { [BUKKAKE_UDON]: { price: 1700 } }, async () => {
      await pressOrderAgain(page);
      await expect(page).toHaveURL(/\/checkout/); // sync: rebuilt basket shown

      await expect(checkoutLine(page, "Bukkake Udon").locator("span").last()).toHaveText("1,700 AMD"); // expected[1]
      await expect(subtotal(page)).toHaveText("5,700 AMD"); // expected[2]
    });
  });

  test("KAN-10-TC-08 Basket has another chef's food, customer answers No: basket unchanged", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-08 auto", O1);
    await setSignedIn(page, customer);
    await addDish(page, 17, "Quiche with mushrooms");

    await pressOrderAgain(page);
    await expect(page.getByText(REPLACE_QUESTION, { exact: true })).toBeVisible(); // expected[1]
    await page.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByText(REPLACE_QUESTION, { exact: true })).toBeHidden(); // sync: question closed

    await expectBasketOnly(page, 17, "Quiche with mushrooms", "1,200 AMD"); // expected[2]
  });

  test("KAN-10-TC-09 Basket has another chef's food, customer answers Yes: replaced by the old order", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-09 auto", O1);
    await setSignedIn(page, customer);
    await addDish(page, 17, "Quiche with mushrooms");

    await pressOrderAgain(page);
    await expect(page.getByText(REPLACE_QUESTION, { exact: true })).toBeVisible(); // expected[1]
    await page.getByRole("button", { name: "Yes, replace" }).click();

    await expect(page).toHaveURL(/\/checkout/); // expected[2]
    // expected[3]: 2 × Crispy Salad with Sweet Chile and 1 × Bukkake Udon, no Quiche with mushrooms
    await expectLine(page, 2, "Crispy Salad", "Sweet Chile");
    await expectLine(page, 1, "Bukkake Udon");
    await expect(checkoutLine(page, "Quiche with mushrooms")).toHaveCount(0);
    await expect(subtotal(page)).toHaveText("5,500 AMD"); // expected[4]
  });

  test("KAN-10-TC-10 Basket has the same chef's food: replaced without asking", async ({ page, request }) => {
    test.fail(true, "KAN-26: KAN-10: Order again adds the old order to a same-chef basket instead of replacing it (Q-2)");
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-10 auto", O1);
    await setSignedIn(page, customer);
    await addDish(page, CHEF, "Kake udon");

    await pressOrderAgain(page);

    await expect(page).toHaveURL(/\/checkout/); // expected[2]
    await expect(page.getByText(REPLACE_QUESTION, { exact: true })).toHaveCount(0); // expected[1]
    // expected[3]: 2 × Crispy Salad with Sweet Chile and 1 × Bukkake Udon, no Kake udon
    await expectLine(page, 2, "Crispy Salad", "Sweet Chile");
    await expectLine(page, 1, "Bukkake Udon");
    await expect(checkoutLine(page, "Kake udon")).toHaveCount(0);
    await expect(subtotal(page)).toHaveText("5,500 AMD"); // expected[4]
  });

  test("KAN-10-TC-11 Nothing available while the basket has another chef's food: told, no question, basket untouched", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-11 auto", O1);
    await setSignedIn(page, customer);
    await addDish(page, 17, "Quiche with mushrooms");

    await withDishChanges(request, { [CRISPY_SALAD]: { status: "INACTIVE" }, [BUKKAKE_UDON]: { status: "INACTIVE" } }, async () => {
      await pressOrderAgain(page);

      await expect(page.getByText("None of these dishes are available anymore", { exact: true })).toBeVisible(); // expected[1]
      await expect(page.getByText(REPLACE_QUESTION, { exact: true })).toHaveCount(0); // expected[2]
      await expectBasketOnly(page, 17, "Quiche with mushrooms", "1,200 AMD"); // expected[3]
    });
  });

  test("KAN-10-TC-13 Double press during the rebuild: loading state, dishes added once", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    await placeOrder(request, customer, "STLC KAN-10 KAN-10-TC-13 auto", O1);
    await setSignedIn(page, customer);

    // Hold the menu check until both presses are made, so the rebuild is in progress.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/chef/${CHEF}`, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/orders");
    const button = page.getByRole("button", { name: /Order again|Adding to basket/ });
    await button.click();
    // expected[1]: loading state, can't be pressed
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await button.dispatchEvent("click"); // the second press, made while it is loading
    release();

    await expect(page).toHaveURL(/\/checkout/); // sync: rebuilt basket shown
    // expected[2]: 2 × Crispy Salad with Sweet Chile and 1 × Bukkake Udon (not doubled)
    await expectLine(page, 2, "Crispy Salad", "Sweet Chile");
    await expectLine(page, 1, "Bukkake Udon");
    await expect(subtotal(page)).toHaveText("5,500 AMD"); // expected[3]
  });

  test.describe("mobile", () => {
    test.use(mobile375);

    test("KAN-10-TC-03 [mobile] All dishes available: basket rebuilt with the same dishes, quantities and extras, then checkout", async ({ page, request }) => {
      await tc03(page, request);
    });
  });
});
