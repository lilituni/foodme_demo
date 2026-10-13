import { test, expect, devices, type APIRequestContext, type Page } from "@playwright/test";

// KAN-11 promo codes: one test per approved test case (functional-testing
// workflow, step 06). The cases in runs/KAN-11/spec.yaml are the spec; every
// assertion checks the case's expected value word for word (`// expected[n]`).
// Lines marked `// sync:` only wait for the app to settle and check no case fact.

const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";
const CHEF_URL = "/chef/17";

/** A fresh customer per test, signed in through the app's own storage key. */
async function signInNewCustomer(page: Page, request: APIRequestContext) {
  const email = `stlc-kan11-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { fullName: "STLC Tester", email, phoneNumber: "+37491000000", password: "secret123" },
  });
  expect(res.ok()).toBeTruthy(); // sync: account created
  const auth = await res.json();
  await page.addInitScript((value) => {
    localStorage.setItem("foodme.customer.auth", value);
  }, JSON.stringify(auth));
  return auth.token as string;
}

/** Opens the dish on the chef page and adds `quantity` of it to the cart. */
async function addDish(page: Page, name: string, quantity = 1) {
  const cart = page.locator("aside.uc-panel");
  const linesBefore = await cart.locator(".cic_root").count();
  await page.locator("button.dc_card").filter({ has: page.getByText(name, { exact: true }) }).click();
  const dialog = page.getByRole("dialog");
  for (let i = 1; i < quantity; i++) {
    await dialog.getByRole("button", { name: "Increase quantity" }).click();
  }
  await dialog.getByRole("button", { name: /^Add to cart/ }).click();
  await expect(dialog).toBeHidden(); // sync: modal closes after adding
  await expect(cart.locator(".cic_root")).toHaveCount(linesBefore + 1); // sync: cart line saved (FM-FLAKE-05)
}

async function goToCheckout(page: Page, method: "Delivery" | "Takeaway") {
  await page.locator("aside.uc-panel").getByRole("link", { name: "Go to checkout" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByRole("form", { name: "Checkout" }).getByRole("button", { name: new RegExp(`^${method}`) }).click();
}

async function applyCode(page: Page, code: string) {
  const field = page.getByLabel("Promo code", { exact: true });
  await field.clear();
  await field.fill(code);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
}

const summary = (page: Page) => page.locator(".cps_wrap");
const summaryRow = (page: Page, label: string | RegExp) =>
  summary(page)
    .locator("div.justify-between")
    .filter({ has: page.getByText(label, { exact: true }) });
const totalValue = (page: Page) => summaryRow(page, "Total").locator("span").nth(1);
const anyDiscountLine = (page: Page) => summary(page).getByText(/^Discount \(/);

/** "a discount line shows <code> and <amount>": the line names the code and its value is the amount. */
async function expectDiscountLine(page: Page, code: string, amount: string) {
  const row = summaryRow(page, `Discount (${code})`);
  await expect(row).toHaveCount(1);
  await expect(row.locator("span").nth(1)).toHaveText(new RegExp(`^−?${amount}$`));
}

/** Runs the case's first steps: chef 17, add the dishes. */
async function openChefAndAdd(page: Page, dishes: [string, number][]) {
  await page.goto(CHEF_URL);
  for (const [name, qty] of dishes) await addDish(page, name, qty);
}

const B3050: [string, number][] = [["Mushroom soup", 1], ["Quiche with vegetables", 1]];
const B3000: [string, number][] = [["Bacon and arugula sandwich", 1], ["Quiche with mushrooms", 1]];

async function tc01(page: Page) {
  await openChefAndAdd(page, B3050);
  await goToCheckout(page, "Delivery");
  await applyCode(page, "SAVE10");

  await expectDiscountLine(page, "SAVE10", "305 AMD"); // expected[1]
  await expect(totalValue(page)).toHaveText("3,245 AMD"); // expected[2]

  await page.getByRole("form", { name: "Checkout" }).getByRole("button", { name: /^Takeaway/ }).click();

  await expectDiscountLine(page, "SAVE10", "305 AMD"); // expected[3]
  await expect(totalValue(page)).toHaveText("2,745 AMD"); // expected[4]
}

// KAN-11-TC-08 (replace), shared by the desktop and mobile tests.
async function tc08(page: Page) {
  await openChefAndAdd(page, [["Croissant with salmon and avocado", 1], ["Beef sandwich with quinoa without bread", 2]]);
  await goToCheckout(page, "Takeaway");

  await applyCode(page, "SAVE10");
  // expected[1]: SAVE10 800 AMD, Total 7,200 AMD
  await expectDiscountLine(page, "SAVE10", "800 AMD");
  await expect(totalValue(page)).toHaveText("7,200 AMD");

  await applyCode(page, "TREAT15");
  // expected[2]: TREAT15 1,200 AMD, Total 6,800 AMD
  await expectDiscountLine(page, "TREAT15", "1,200 AMD");
  await expect(totalValue(page)).toHaveText("6,800 AMD");
  await expect(summary(page).getByText("Discount (SAVE10)", { exact: true })).toHaveCount(0); // expected[3]
}

// KAN-11-TC-10 (remove), shared by the desktop and mobile tests.
async function tc10(page: Page) {
  await openChefAndAdd(page, B3050);
  await goToCheckout(page, "Takeaway");
  await applyCode(page, "SAVE10");

  await expect(totalValue(page)).toHaveText("2,745 AMD"); // expected[1]
  await page.getByRole("button", { name: "Remove promo code" }).click();
  await expect(anyDiscountLine(page)).toHaveCount(0); // expected[2]
  await expect(totalValue(page)).toHaveText("3,050 AMD"); // expected[3]
}

// Pixel 7 without defaultBrowserType, which can't be set inside a describe group.
const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

test.describe("KAN-11 promo codes - approved cases", () => {
  let token = "";
  test.beforeEach(async ({ page, request }) => {
    token = await signInNewCustomer(page, request);
  });

  test("KAN-11-TC-01 SAVE10 above its minimum with delivery: discount from the subtotal only; switching to Takeaway re-prices live", async ({ page }) => {
    await tc01(page);
  });

  test("KAN-11-TC-02 SAVE10 with a subtotal exactly at its 3,000 AMD minimum applies", async ({ page }) => {
    await openChefAndAdd(page, B3000);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "SAVE10");

    await expectDiscountLine(page, "SAVE10", "300 AMD"); // expected[1]
    await expect(totalValue(page)).toHaveText("2,700 AMD"); // expected[2]
  });

  test("KAN-11-TC-03 SAVE10 with a subtotal 50 AMD below its minimum is rejected with the missing amount", async ({ page }) => {
    await openChefAndAdd(page, [["Quiche with mushrooms", 2], ["Pie with beans", 1]]);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "SAVE10");

    await expect(page.getByText("Add 50 AMD more to use this code", { exact: true })).toBeVisible(); // expected[1]
    await expect(anyDiscountLine(page)).toHaveCount(0); // expected[2]
    await expect(totalValue(page)).toHaveText("2,950 AMD"); // expected[3]
  });

  test("KAN-11-TC-04 TREAT15 on 8,050 AMD: a fractional discount is rounded down", async ({ page }) => {
    test.fail(true, "KAN-19: TREAT15 discount on 8,050 AMD shown as 1,208 AMD (rounded up), Q-2 says round down; discount and total don't add up");
    await openChefAndAdd(page, [["Mushroom soup", 1], ["Borscht", 2], ["Quiche with vegetables", 2]]);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "TREAT15");

    await expectDiscountLine(page, "TREAT15", "1,207 AMD"); // expected[1]
    await expect(totalValue(page)).toHaveText("6,843 AMD"); // expected[2]
  });

  test("KAN-11-TC-05 The expired code OLD15 is rejected", async ({ page }) => {
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "OLD15");

    await expect(page.getByText("This code has expired", { exact: true })).toBeVisible(); // expected[1]
    await expect(anyDiscountLine(page)).toHaveCount(0); // expected[2]
    await expect(totalValue(page)).toHaveText("3,050 AMD"); // expected[3]
  });

  test("KAN-11-TC-06 An unknown code NOPE99 is rejected", async ({ page }) => {
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "NOPE99");

    await expect(page.getByText("Code not found", { exact: true })).toBeVisible(); // expected[1]
    await expect(anyDiscountLine(page)).toHaveCount(0); // expected[2]
    await expect(totalValue(page)).toHaveText("3,050 AMD"); // expected[3]
  });

  test("KAN-11-TC-07 Near-matches of SAVE10 (lower case, surrounding spaces) are not accepted", async ({ page }) => {
    test.fail(true, "KAN-20: promo codes accepted in lower case and with surrounding spaces (Q-3 says exact match only)");
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");

    await applyCode(page, "save10");
    // expected[1]: "Code not found", no discount line, Total 3,050 AMD
    await expect(page.getByText("Code not found", { exact: true })).toBeVisible();
    await expect(anyDiscountLine(page)).toHaveCount(0);
    await expect(totalValue(page)).toHaveText("3,050 AMD");

    await applyCode(page, " SAVE10 ");
    // expected[2]: "Code not found", no discount line, Total 3,050 AMD
    await expect(page.getByText("Code not found", { exact: true })).toBeVisible();
    await expect(anyDiscountLine(page)).toHaveCount(0);
    await expect(totalValue(page)).toHaveText("3,050 AMD");
  });

  test("KAN-11-TC-08 Applying TREAT15 after SAVE10 replaces it (TREAT15 at its 8,000 AMD minimum)", async ({ page }) => {
    await tc08(page);
  });

  test("KAN-11-TC-09 A rejected second code leaves the first code applied", async ({ page }) => {
    test.fail(true, "KAN-21: applying an unknown second promo code removes the already-applied code (Q-5 says it should stay)");
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "SAVE10");
    await expect(summaryRow(page, "Discount (SAVE10)")).toHaveCount(1); // sync: first code applied
    await applyCode(page, "NOPE99");

    await expect(page.getByText("Code not found", { exact: true })).toBeVisible(); // expected[1]
    await expectDiscountLine(page, "SAVE10", "305 AMD"); // expected[2]
    await expect(totalValue(page)).toHaveText("2,745 AMD"); // expected[3]
  });

  test("KAN-11-TC-10 Removing the applied code restores the original total", async ({ page }) => {
    await tc10(page);
  });

  test("KAN-11-TC-11 Apply is disabled while the promo code field is empty", async ({ page }) => {
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");
    const field = page.getByLabel("Promo code", { exact: true });
    const apply = page.getByRole("button", { name: "Apply", exact: true });

    await expect(field).toHaveValue(""); // sync: field starts empty
    await expect(apply).toBeDisabled(); // expected[1]
    await field.pressSequentially("S");
    await expect(apply).toBeEnabled(); // expected[2]
    await field.press("Backspace");
    await expect(field).toHaveValue(""); // sync: field empty again
    await expect(apply).toBeDisabled(); // expected[3]
  });

  test("KAN-11-TC-12 Cart drops below the minimum in another tab after SAVE10 was applied: re-checked live", async ({ page, context }) => {
    await openChefAndAdd(page, B3000);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "SAVE10");

    // expected[1]: SAVE10 300 AMD, Total 2,700 AMD
    await expectDiscountLine(page, "SAVE10", "300 AMD");
    await expect(totalValue(page)).toHaveText("2,700 AMD");

    const second = await context.newPage();
    await second.goto(CHEF_URL);
    const cart = second.locator("aside.uc-panel");
    await cart.locator(".cic_root").filter({ hasText: "Quiche with mushrooms" }).getByRole("button", { name: "Remove item" }).click();
    await expect(cart.locator(".cic_root")).toHaveCount(1); // sync: removed in the second tab

    await page.bringToFront(); // back to the checkout tab, no reload
    // Precondition check from the case: only the sandwich is left, subtotal 1,800 AMD.
    await expect(summaryRow(page, "Subtotal").locator("span").nth(1)).toHaveText("1,800 AMD");
    await expect(page.getByText("Quiche with mushrooms")).toHaveCount(0);
    await expect(page.getByText("Bacon and arugula sandwich").first()).toBeVisible();

    await expect(page.getByText(/^Add 1,?200 AMD more to use this code$/)).toBeVisible(); // expected[2]
    await expect(anyDiscountLine(page)).toHaveCount(0); // expected[3]
    await expect(totalValue(page)).toHaveText("1,800 AMD"); // expected[4]
  });

  test("KAN-11-TC-13 An order placed with SAVE10 saves the code and the discount", async ({ page, request }) => {
    await openChefAndAdd(page, B3050);
    await goToCheckout(page, "Takeaway");
    await applyCode(page, "SAVE10");
    await expect(summaryRow(page, "Discount (SAVE10)")).toHaveCount(1); // sync: code applied before ordering

    const form = page.getByRole("form", { name: "Checkout" });
    await form.getByRole("radio", { name: /Cash on delivery/i }).check();
    const note = "STLC KAN-11 TC-13";
    await form.locator("#note").fill(note);
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/success/); // sync: order sent

    const res = await request.get(`${API}/api/customer/orders`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.ok()).toBeTruthy(); // sync: orders readable
    const { list } = await res.json();
    // expected[1]: the order is placed and is this (fresh) customer's newest order
    const newest = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    expect(newest?.note).toBe(note);
    expect(newest.promoCode).toBe("SAVE10"); // expected[2]
    expect(newest.discount).toBe(305); // expected[3]
    expect(newest.totalPrice).toBe(2745); // expected[4]
  });

  test.describe("mobile", () => {
    test.use(pixel7);

    test("KAN-11-TC-01 [mobile] SAVE10 above its minimum with delivery: discount from the subtotal only; switching to Takeaway re-prices live", async ({ page }) => {
      await tc01(page);
    });

    test("KAN-11-TC-08 [mobile] Applying TREAT15 after SAVE10 replaces it (TREAT15 at its 8,000 AMD minimum)", async ({ page }) => {
      await tc08(page);
    });

    test("KAN-11-TC-10 [mobile] Removing the applied code restores the original total", async ({ page }) => {
      await tc10(page);
    });
  });
});
