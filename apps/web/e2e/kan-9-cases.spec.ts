import { test, expect, devices, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// KAN-9 cancel order: one test per approved storefront test case (functional-
// testing workflow, step 06). The cases in runs/KAN-9/spec.yaml are the spec;
// every assertion checks the case's expected value (`// expected[n]`).
// Lines marked `// sync:` only wait for the app to settle and check no case fact.

const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";
const AUTH_KEY = "foodme.customer.auth";
const ONLY_NEW = "Only new orders can be cancelled.";

type Customer = { token: string; auth: string };

async function registerCustomer(request: APIRequestContext, who: string): Promise<Customer> {
  const email = `stlc-kan9-${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { fullName: "STLC Tester", email, phoneNumber: "+37491000000", password: "secret123" },
  });
  expect(res.ok()).toBeTruthy(); // sync: account created
  const body = await res.json();
  return { token: body.token as string, auth: JSON.stringify(body) };
}

/** Signs the customer in for the whole test, through the app's own storage key. */
async function signInForTest(page: Page, customer: Customer) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [AUTH_KEY, customer.auth]);
}

/** Switches the session in an open page (TC-04 signs out and in again). */
async function switchSession(page: Page, customer: Customer | null) {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => (value ? localStorage.setItem(key, value) : localStorage.removeItem(key)),
    [AUTH_KEY, customer?.auth ?? ""],
  );
}

/** Opens the dish on the chef page and adds one to the cart. */
async function addDish(page: Page, name: string) {
  const cart = page.locator("aside.uc-panel");
  const linesBefore = await cart.locator(".cic_root").count();
  await page.locator("button.dc_card").filter({ has: page.getByText(name, { exact: true }) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Add to cart/ }).click();
  await expect(dialog).toBeHidden(); // sync: modal closes after adding
  await expect(cart.locator(".cic_root")).toHaveCount(linesBefore + 1); // sync: cart line saved (FM-FLAKE-05)
}

/** O-std through the storefront: chef 17, 1 × Mushroom soup, Takeaway, cash. Returns FM-xxxxxx. */
async function placeOStd(page: Page, caseId: string) {
  await page.goto("/chef/17");
  await addDish(page, "Mushroom soup");
  await page.locator("aside.uc-panel").getByRole("link", { name: "Go to checkout" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  const form = page.getByRole("form", { name: "Checkout" });
  await form.getByRole("button", { name: /^Takeaway/ }).click();
  await form.getByRole("radio", { name: /Cash on delivery/i }).check();
  await form.locator("#note").fill(`STLC KAN-9 ${caseId} auto`);
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/success\?number=FM-\d+/); // sync: order sent
  return new URL(page.url()).searchParams.get("number")!;
}

/** The admin's Accept, as the admin panel sends it (PATCH captured in step 05). */
async function acceptAsAdmin(request: APIRequestContext, number: string) {
  const login = await request.post(`${API}/admin/auth/login`, { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBeTruthy(); // sync: admin signed in
  const { token } = await login.json();
  const order = await (await request.get(`${API}/api/order/number/${number}`)).json();
  const res = await request.patch(`${API}/admin/order/${order.id}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { status: "ACCEPTED", rejectReason: null },
  });
  expect(res.ok()).toBeTruthy(); // sync: kitchen accepted
}

/** The order's status as My Orders loads it (GET /api/customer/orders). */
async function statusOnMyOrders(request: APIRequestContext, customer: Customer, number: string) {
  const res = await request.get(`${API}/api/customer/orders`, { headers: { Authorization: `Bearer ${customer.token}` } });
  expect(res.ok()).toBeTruthy(); // sync: orders readable
  const { list } = await res.json();
  return list.find((o: { number: string }) => o.number === number)?.status as string | undefined;
}

const orderCard = (page: Page, number: string) => page.getByRole("listitem").filter({ hasText: number });
const cancelButton = (scope: Page | Locator) => scope.getByRole("button", { name: "Cancel order", exact: true });
const confirmation = (page: Page) => page.getByRole("alertdialog");
// The sources quote "can't" with a straight apostrophe; the human accepted the typographic one in step 05.
const CANT_BE_UNDONE = /^This can['’]t be undone\.$/;

/** "Neutral grey": the computed text colour has (almost) no chroma, unlike the red "Declined". */
async function expectNeutralGrey(label: Locator) {
  const color = await label.evaluate((el) => getComputedStyle(el).color);
  const oklch = color.match(/^oklch\(\s*[\d.]+%?\s+([\d.]+)/);
  if (oklch) {
    expect(Number(oklch[1]), `colour ${color}`).toBeLessThan(0.04);
  } else {
    const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number);
    expect(Math.max(r, g, b) - Math.min(r, g, b), `colour ${color}`).toBeLessThan(20);
  }
}

// KAN-9-TC-01, shared by the desktop and mobile tests.
async function tc01(page: Page) {
  const number = await placeOStd(page, "TC-01");
  await page.goto("/orders");
  const card = orderCard(page, number);
  await expect(card.getByText("Received", { exact: true })).toBeVisible(); // sync: order is Received
  await expect(cancelButton(card)).toBeVisible(); // expected[1]

  await cancelButton(card).click();
  const dialog = confirmation(page);
  await expect(dialog.getByRole("heading", { name: `Cancel order ${number}?` })).toBeVisible(); // expected[2] own number
  await expect(dialog.getByText(CANT_BE_UNDONE)).toBeVisible(); // expected[2]
  await expect(dialog.getByRole("button", { name: "Keep order", exact: true })).toBeVisible(); // expected[3]
  await expect(cancelButton(dialog)).toBeVisible(); // expected[3]

  await cancelButton(dialog).click();
  await expect(dialog).toBeHidden(); // sync: confirmation closed
  const label = card.getByText("Cancelled", { exact: true });
  await expect(label).toBeVisible(); // expected[4]
  await expectNeutralGrey(label); // expected[5]
  await expect(cancelButton(card)).toHaveCount(0); // expected[6]
}

// Pixel 7 without defaultBrowserType, which can't be set inside a describe group.
const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

test.describe("KAN-9 cancel order - approved cases", () => {
  test("KAN-9-TC-01 Owner cancels a Received order from My Orders: confirmation, then grey \"Cancelled\"", async ({ page, request }) => {
    await signInForTest(page, await registerCustomer(request, "a"));
    await tc01(page);
  });

  test("KAN-9-TC-02 Keep order in the confirmation leaves the order Received", async ({ page, request }) => {
    await signInForTest(page, await registerCustomer(request, "a"));
    const number = await placeOStd(page, "TC-02");
    await page.goto("/orders");
    const card = orderCard(page, number);
    await cancelButton(card).click();
    const dialog = confirmation(page);
    await expect(dialog).toBeVisible(); // sync: confirmation open
    await dialog.getByRole("button", { name: "Keep order", exact: true }).click();

    await expect(dialog).toBeHidden(); // expected[1]
    await page.reload();
    await expect(card.getByText("Received", { exact: true })).toBeVisible(); // expected[2]
    await expect(cancelButton(card)).toBeVisible(); // expected[3]
  });

  test("KAN-9-TC-03 Owner cancels from the order tracking page: Cancelled label, no step in progress", async ({ page, request }) => {
    await signInForTest(page, await registerCustomer(request, "a"));
    const number = await placeOStd(page, "TC-03");
    await page.goto(`/tracking/${number}`);
    await expect(page.getByRole("heading", { name: `Order ${number}` })).toBeVisible(); // sync: tracking page loaded
    await expect(cancelButton(page)).toBeVisible(); // expected[1]

    await cancelButton(page).click();
    const dialog = confirmation(page);
    await expect(dialog.getByRole("heading", { name: `Cancel order ${number}?` })).toBeVisible(); // expected[2]
    await expect(dialog.getByText(CANT_BE_UNDONE)).toBeVisible(); // expected[2]
    await expect(dialog.getByRole("button", { name: "Keep order", exact: true })).toBeVisible(); // expected[2]
    await cancelButton(dialog).click();
    await expect(dialog).toBeHidden(); // sync: confirmation closed

    await page.reload();
    await expect(page.getByRole("heading", { name: `Order ${number}` })).toBeVisible(); // sync: reloaded
    const label = page.getByText("Cancelled", { exact: true });
    await expect(label).toBeVisible(); // expected[3] after confirming and the reload
    await expectNeutralGrey(label); // expected[3] neutral grey style
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0); // expected[4] no active step
    await expect(cancelButton(page)).toHaveCount(0); // expected[5]
  });

  test("KAN-9-TC-04 Tracking page shows no Cancel button when signed out or to another customer", async ({ page, request }) => {
    test.fail(true, "KAN-24: Tracking page shows Cancel order button on another customer's order (Q-5 says owner only)");
    const customerA = await registerCustomer(request, "a");
    const customerB = await registerCustomer(request, "b");
    await switchSession(page, customerA);
    const number = await placeOStd(page, "TC-04"); // precondition: A's Received order
    const heading = page.getByRole("heading", { name: `Order ${number}` });

    await switchSession(page, null);
    await page.goto(`/tracking/${number}`);
    await expect(heading).toBeVisible(); // sync: tracking page loaded
    await expect(cancelButton(page)).toHaveCount(0); // expected[1] signed out

    await switchSession(page, customerB);
    await page.goto(`/tracking/${number}`);
    await expect(heading).toBeVisible(); // sync: tracking page loaded
    await expect(cancelButton(page)).toHaveCount(0); // expected[2] customer B

    await switchSession(page, customerA);
    await page.goto(`/tracking/${number}`);
    await expect(heading).toBeVisible(); // sync: tracking page loaded
    await expect(cancelButton(page)).toBeVisible(); // expected[3] customer A (control)
    expect(await statusOnMyOrders(request, customerA, number)).toBe("NEW"); // expected[3] still Received
  });

  test("KAN-9-TC-05 Accepted order: no Cancel button after reload, and cancel is refused by the API", async ({ page, request }) => {
    const customerA = await registerCustomer(request, "a");
    await signInForTest(page, customerA);

    // Step 1: capture the cancel request on FM-x.
    const fmX = await placeOStd(page, "TC-05");
    await page.goto("/orders");
    await cancelButton(orderCard(page, fmX)).click();
    const captured = page.waitForRequest((r) => r.url().includes(`/${fmX}/`) && r.method() !== "OPTIONS");
    await cancelButton(confirmation(page)).click();
    const cancelRequest = await captured;
    await expect(orderCard(page, fmX).getByText("Cancelled", { exact: true })).toBeVisible(); // sync: FM-x cancelled

    // Steps 2-3: FM-xxxxxx placed, then accepted in the admin panel.
    const number = await placeOStd(page, "TC-05");
    await acceptAsAdmin(request, number);

    // Step 4: reload My Orders and the tracking page.
    await page.goto("/orders");
    await page.reload();
    const card = orderCard(page, number);
    await expect(card).toBeVisible(); // sync: My Orders loaded
    await expect(cancelButton(card)).toHaveCount(0); // expected[1]
    await page.goto(`/tracking/${number}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: `Order ${number}` })).toBeVisible(); // sync: tracking page loaded
    await expect(cancelButton(page)).toHaveCount(0); // expected[2]

    // Step 5: the captured request with FM-x's id replaced by FM-xxxxxx's.
    const res = await request.fetch(cancelRequest.url().replace(fmX, number), {
      method: cancelRequest.method(),
      headers: { Authorization: (await cancelRequest.allHeaders())["authorization"] },
    });
    expect(res.ok()).toBeFalsy(); // expected[3] refused
    expect(await res.text()).toContain(ONLY_NEW); // expected[3] reason

    // Step 6: My Orders' status (the storefront shows ACCEPTED as "Preparing"; step 05 read it from the API too).
    expect(await statusOnMyOrders(request, customerA, number)).toBe("ACCEPTED"); // expected[4]
  });

  test("KAN-9-TC-06 Stale page: kitchen accepts after My Orders loaded, customer presses Cancel", async ({ page, request }) => {
    const customerA = await registerCustomer(request, "a");
    await signInForTest(page, customerA);
    const number = await placeOStd(page, "TC-06");
    await page.goto("/orders");
    const card = orderCard(page, number);
    await expect(cancelButton(card)).toBeVisible(); // sync: step 1, Cancel order visible

    await acceptAsAdmin(request, number); // step 2, without reloading My Orders

    await cancelButton(card).click();
    await cancelButton(confirmation(page)).click();

    await expect(card.getByRole("alert")).toHaveText(ONLY_NEW); // expected[1]
    // expected[2]: the order refreshes to its real status. The storefront's word for ACCEPTED is
    // "Preparing" (accepted as a match by the human in step 05); never "Cancelled".
    await expect(card.getByText("Preparing", { exact: true })).toBeVisible();
    await expect(card.getByText("Cancelled", { exact: true })).toHaveCount(0);
    expect(await statusOnMyOrders(request, customerA, number)).toBe("ACCEPTED");
    await expect(cancelButton(card)).toHaveCount(0); // expected[3]
  });

  test.describe("mobile", () => {
    test.use(pixel7);

    test("KAN-9-TC-01 [mobile] Owner cancels a Received order from My Orders: confirmation, then grey \"Cancelled\"", async ({ page, request }) => {
      await signInForTest(page, await registerCustomer(request, "a"));
      await tc01(page);
    });
  });
});
