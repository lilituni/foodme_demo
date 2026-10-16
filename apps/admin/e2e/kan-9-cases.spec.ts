import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// KAN-9 cancel order: one test per approved admin-panel test case (functional-
// testing workflow, step 06). The cases in runs/KAN-9/spec.yaml are the spec;
// every assertion checks the case's expected value (`// expected[n]`).
// Lines marked `// sync:` only wait for the app to settle and check no case fact.
// Customer orders are placed and cancelled through the customer API (the
// storefront is a different app); admin actions go through the admin UI or API.

const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";
const CHEF = 17; // Verona
const MUSHROOM_SOUP = 132; // 1,950 AMD
const QUICHE = 115; // 1,100 AMD

async function loginAsAdmin(page: Page) {
  await page.goto("/#/login");
  await expect(page.getByRole("heading", { name: "FoodMe Admin" })).toBeVisible();
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("menuitem", { name: "Orders" })).toBeVisible({ timeout: 15000 });
}

async function registerCustomer(request: APIRequestContext) {
  const email = `stlc-kan9-a-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { fullName: "STLC Tester", email, phoneNumber: "+37491000000", password: "secret123" },
  });
  expect(res.ok()).toBeTruthy(); // sync: account created
  return (await res.json()).token as string;
}

/** Places a Takeaway, cash order for the customer and returns its number. */
async function placeOrder(request: APIRequestContext, token: string, caseId: string, dishes: number[]) {
  const res = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      chefId: CHEF,
      receiverName: "STLC Tester",
      receiverPhoneNumber: "+37491000000",
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note: `STLC KAN-9 ${caseId} auto`,
      createOrderDishes: dishes.map((dishId) => ({ dishId, quantity: 1 })),
    },
  });
  expect(res.ok()).toBeTruthy(); // sync: order placed
  return (await res.json()).number as string;
}

async function cancelAsCustomer(request: APIRequestContext, token: string, number: string) {
  const res = await request.post(`${API}/api/customer/orders/${number}/cancel`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy(); // sync: customer cancelled
}

async function adminLogin(request: APIRequestContext) {
  const login = await request.post(`${API}/admin/auth/login`, { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBeTruthy(); // sync: admin signed in
  return (await login.json()).token as string;
}

type OrderSnapshot = Map<number, { number: string; status: string; totalPrice: number; key: string }>;

/** The newest 100 orders, as the dashboard requests them (id → status and total). */
async function recentOrders(request: APIRequestContext, token: string): Promise<OrderSnapshot> {
  const res = await request.get(`${API}/admin/order?page=0&size=100`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy(); // sync: orders read
  const list: { id: number; number: string; status: string; totalPrice: number }[] = (await res.json()).list;
  return new Map(list.map((o) => [o.id, { ...o, key: `${o.status}:${o.totalPrice}` }]));
}

const same = (a: OrderSnapshot, b: OrderSnapshot) =>
  a.size === b.size && [...a].every(([id, o]) => b.get(id)?.key === o.key);

/** The admin's Reject (decline), as the admin panel sends it. */
async function rejectAsAdmin(request: APIRequestContext, number: string) {
  const token = await adminLogin(request);
  const order = await (await request.get(`${API}/api/order/number/${number}`)).json();
  const res = await request.patch(`${API}/admin/order/${order.id}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { status: "REJECTED", rejectReason: `STLC KAN-9 declined` },
  });
  expect(res.ok()).toBeTruthy(); // sync: declined
}

const row = (page: Page, number: string) => page.getByRole("row").filter({ hasText: number });
const statusChip = (scope: Locator) => scope.locator(".MuiChip-root");
const background = (chip: Locator) => chip.evaluate((el) => getComputedStyle(el).backgroundColor);
// The admin panel prints every status as its upper-case code; the human accepted
// "CANCELLED" as the "Cancelled" label in step 05.
const CANCELLED = /^cancelled$/i;

/** "AMD 12,345" → 12345, once the card has finished loading. */
async function revenueFigure(page: Page) {
  const value = page.locator(".MuiCard-root").filter({ hasText: "Recent revenue" }).locator("h5");
  await expect(value).toHaveText(/AMD/); // sync: figure loaded
  return Number((await value.innerText()).replace(/\D/g, ""));
}

test.describe("KAN-9 cancel order - approved admin cases", () => {
  test("KAN-9-TC-10 Admin panel: Cancelled label, colour, filter, note, no actions; no Cancel action for admins", async ({ page, request }) => {
    const customer = await registerCustomer(request);
    const fmC = await placeOrder(request, customer, "TC-10", [MUSHROOM_SOUP]);
    await cancelAsCustomer(request, customer, fmC);
    const fmR = await placeOrder(request, customer, "TC-10", [MUSHROOM_SOUP]);
    const declined = await placeOrder(request, customer, "TC-10", [MUSHROOM_SOUP]);
    await rejectAsAdmin(request, declined); // precondition: a Declined order exists

    await loginAsAdmin(page);
    // Step 1: the order list.
    await page.goto("/#/orders");
    const cancelledChip = statusChip(row(page, fmC));
    await expect(cancelledChip).toHaveText(CANCELLED); // expected[1]

    await expect(statusChip(row(page, declined))).toHaveText(/^rejected$/i); // sync: Declined row shown
    await expect(statusChip(row(page, fmR))).toHaveText(/^new$/i); // sync: Received row shown
    const cancelledColour = await background(cancelledChip);
    const others = page.locator(".MuiChip-root").filter({ hasNotText: CANCELLED });
    const otherColours = new Map<string, string>();
    for (const chip of await others.all()) otherColours.set(await chip.innerText(), await background(chip));
    expect(otherColours.get("REJECTED"), "Declined chip").not.toBe(cancelledColour); // expected[2] vs Declined
    for (const [status, colour] of otherColours) {
      expect(colour, `${status} chip`).not.toBe(cancelledColour); // expected[2] vs every other status
    }

    // Step 2: filter to Cancelled only.
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "CANCELLED" }).click();
    await expect(page).toHaveURL(/CANCELLED/); // sync: filter applied
    await expect(row(page, fmC)).toBeVisible(); // expected[3] FM-c listed
    const chips = page.locator("tbody .MuiChip-root");
    await expect(chips.first()).toBeVisible(); // sync: rows rendered
    // Auto-retries until the filtered page has replaced the unfiltered one; a one-off
    // chips.all() snapshot raced that refetch and pointed at rows that were gone.
    await expect(chips.filter({ hasNotText: CANCELLED })).toHaveCount(0); // expected[3] no other status
    await expect(row(page, fmC)).toBeVisible(); // expected[3] FM-c still listed after the refetch

    // Step 3: FM-c's details.
    await row(page, fmC).click();
    const detailsHeading = page.getByRole("heading", { level: 5, name: `Order ${fmC}`, exact: true });
    await expect(detailsHeading).toBeVisible(); // sync: details open
    await expect(statusChip(detailsHeading.locator(".."))).toHaveText(CANCELLED); // expected[4] label
    await expect(page.getByText("Cancelled by customer", { exact: true })).toBeVisible(); // expected[4] note
    await expect(page.getByRole("button", { name: /accept|deliver|reject|mark as/i })).toHaveCount(0); // expected[5]

    // Step 4: FM-r's details.
    await page.goto("/#/orders?filter=%7B%7D"); // the list remembers the Cancelled filter; clear it
    await row(page, fmR).click();
    await expect(page.getByRole("heading", { level: 5, name: `Order ${fmR}`, exact: true })).toBeVisible(); // sync: details open
    await expect(page.getByRole("button", { name: "Mark as ACCEPTED" })).toBeVisible(); // sync: actions rendered
    await expect(page.getByRole("button", { name: /cancel/i })).toHaveCount(0); // expected[6]
  });

  test("KAN-9-TC-12 Dashboard revenue excludes a cancelled and a declined order", async ({ page, request }) => {
    // "Recent revenue" sums the newest 100 orders of the whole shop, so other test
    // files placing orders on another worker move it too (step 09 finding F-02).
    // The case's steps run as written; a measurement during which any other order
    // appeared or changed is thrown away and the steps are run again.
    test.setTimeout(240_000);
    const adminToken = await adminLogin(request);
    await loginAsAdmin(page);

    let measured: { r0: number; after: number; dropped: number } | null = null;
    for (let attempt = 1; attempt <= 5 && !measured; attempt++) {
      // Step 1: R0, with the dashboard's window of orders unchanged while it loads.
      const s1 = await recentOrders(request, adminToken);
      await page.goto("/#/");
      await page.reload(); // sync: the dashboard fetches the orders again
      const r0 = await revenueFigure(page);
      const s2 = await recentOrders(request, adminToken);

      // Step 2: order A (O-rev), cancelled by customer A.
      const customer = await registerCustomer(request);
      const orderA = await placeOrder(request, customer, "TC-12", [MUSHROOM_SOUP, QUICHE]);
      await cancelAsCustomer(request, customer, orderA);
      // Step 3: order B (O-rev), declined in the admin panel.
      const orderB = await placeOrder(request, customer, "TC-12", [MUSHROOM_SOUP, QUICHE]);
      await rejectAsAdmin(request, orderB);

      // Step 4: reload the dashboard.
      const s3 = await recentOrders(request, adminToken);
      await page.reload();
      const after = await revenueFigure(page);
      const s4 = await recentOrders(request, adminToken);

      const others = new Map([...s3].filter(([, o]) => o.number !== orderA && o.number !== orderB));
      const quiet = same(s1, s2) && same(s3, s4) && [...others].every(([id, o]) => s2.get(id)?.key === o.key);
      if (!quiet) continue; // another worker placed or changed an order meanwhile

      // Orders A and B push the oldest orders out of the 100-order window; their
      // share of R0 leaves the figure for reasons that have nothing to do with A and B.
      const dropped = [...s2]
        .filter(([id, o]) => !others.has(id) && !["CANCELLED", "REJECTED"].includes(o.status))
        .reduce((sum, [, o]) => sum + o.totalPrice, 0);
      measured = { r0, after, dropped };
    }

    expect(measured, "a run of the steps with no other order activity").not.toBeNull(); // sync: isolated run
    const { r0, after, dropped } = measured!;
    expect(after + dropped).toBe(r0); // expected[1]
    expect([r0 + 3050, r0 + 6100]).not.toContain(after + dropped); // expected[2]
  });
});
