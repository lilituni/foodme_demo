import { test, expect, devices, type APIRequestContext, type Page } from "@playwright/test";
import { createAccountAtCheckout, registerCustomerViaApi } from "./auth";

// KAN-11 Promo codes - checkout UI (KAN-29). Launch codes: SAVE10 (10%, min 3,000),
// TREAT15 (15%, min 8,000), OLD15 (expired).
const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";

const amd = (v: number) => `${Math.round(v).toLocaleString("en-US")} AMD`;

interface MenuDish {
  id: number;
  nameEn: string;
  price: number;
  status: string;
  minimumOrderCount: number;
}

/**
 * First chef with a dish matching `pick` among its first visible active dishes
 * (the chef page lists them in the same order).
 */
async function findChefDish(request: APIRequestContext, pick: (dishes: MenuDish[]) => MenuDish | undefined) {
  const chefs = await (await request.get(`${API}/api/chef/active?page=0&size=50`)).json();
  for (const chef of chefs.exploreChefResponseDtoList) {
    const detail = await (await request.get(`${API}/api/chef/${chef.id}`)).json();
    const dishes: MenuDish[] = detail.dishes.filter((d: MenuDish) => d.status === "ACTIVE").slice(0, 8);
    const dish = pick(dishes);
    if (dish) return { chefId: chef.id as number, dish };
  }
  throw new Error("No chef in the seed data has a matching dish");
}

const priciest = (dishes: MenuDish[]) => [...dishes].sort((a, b) => b.price - a.price)[0];

/** Puts `quantity` of one dish in the basket via the chef page; returns the subtotal. */
async function fillBasket(page: Page, chefId: number, dish: MenuDish, quantity: number) {
  await page.goto(`/chef/${chefId}`);
  await page.locator("button.dc_card").filter({ hasText: dish.nameEn }).first().click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  const line = page.locator("aside.uc-panel .cic_root");
  await expect(line).toHaveCount(1);
  const start = Math.max(dish.minimumOrderCount ?? 1, 1);
  for (let q = start; q < quantity; q++) {
    await line.getByRole("button", { name: "Increase quantity" }).click();
    await expect(line.locator(".fm-qty-grp p")).toHaveText(String(q + 1));
  }
  return dish.price * Math.max(start, quantity);
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${next}`);
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("secret123");
  await form.getByRole("button", { name: "Sign in" }).click();
  // Not toHaveURL(next): "/login?next=/orders" would already match that.
  await expect(page).not.toHaveURL(/\/login/);
}

function summary(page: Page) {
  const prices = page.locator(".cps_wrap");
  return {
    total: prices.locator("div").filter({ has: page.getByText("Total", { exact: true }) }).last(),
    discountLine: (code: string) => prices.getByText(`Discount (${code})`),
    anyDiscount: prices.getByText(/^Discount \(/),
  };
}

// By role: getByLabel("Promo code") would also match the "Remove promo code" button.
const promoInput = (page: Page) => page.getByRole("textbox", { name: "Promo code" });

async function applyCode(page: Page, code: string) {
  await promoInput(page).fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
}

const { defaultBrowserType: _d, ...desktop } = devices["Desktop Chrome"];
const { defaultBrowserType: _m, ...mobile } = devices["Pixel 7"];

for (const vp of [
  { name: "desktop", use: desktop },
  { name: "mobile", use: mobile },
]) {
  test.describe(`promo codes (${vp.name})`, () => {
    test.use(vp.use);

    test("apply a code -> discount + new total -> replace with another -> remove", async ({
      page,
      request,
    }) => {
      // The priciest of the first dishes keeps the number of clicks to reach 8,000 low.
      const { chefId, dish } = await findChefDish(request, priciest);
      const subtotal = await fillBasket(page, chefId, dish, Math.ceil(8000 / dish.price));
      expect(subtotal).toBeGreaterThanOrEqual(8000);

      await page.locator("aside.uc-panel").getByRole("link", { name: "Go to checkout" }).click();
      await createAccountAtCheckout(page, "Promo Tester");
      const { total, discountLine, anyDiscount } = summary(page);
      await expect(total).not.toContainText("—");
      const totalBefore = Number((await total.innerText()).replace(/[^\d]/g, ""));

      // 1-2. SAVE10: discount line and new total, before the order is placed.
      await applyCode(page, "SAVE10");
      await expect(page.getByRole("status").filter({ hasText: "SAVE10 applied: 10% off" })).toBeVisible();
      await expect(discountLine("SAVE10")).toBeVisible();
      await expect(page.locator(".cps_wrap")).toContainText(`−${amd(subtotal * 0.1)}`);
      await expect(total).toContainText(amd(totalBefore - subtotal * 0.1));

      // 3. Replace with TREAT15: only one code at a time.
      await applyCode(page, "TREAT15");
      await expect(discountLine("TREAT15")).toBeVisible();
      await expect(discountLine("SAVE10")).toHaveCount(0);
      await expect(total).toContainText(amd(totalBefore - subtotal * 0.15));

      // 4. Remove: the total goes back to the original.
      await page.getByRole("button", { name: "Remove promo code" }).click();
      await expect(anyDiscount).toHaveCount(0);
      await expect(total).toContainText(amd(totalBefore));
      await expect(promoInput(page)).toHaveValue("");
    });
  });
}

test.describe("promo codes - rejections and placing the order", () => {
  test("unknown, expired and below-minimum codes show their messages and no discount", async ({
    page,
    request,
  }) => {
    const { email } = await registerCustomerViaApi(request, API);
    const { chefId, dish } = await findChefDish(request, (dishes) =>
      dishes.find((d) => d.price * Math.max(d.minimumOrderCount, 1) < 3000),
    );
    await signIn(page, email, "/orders");
    const subtotal = await fillBasket(page, chefId, dish, 1);
    await page.goto("/checkout");
    const { anyDiscount } = summary(page);

    await applyCode(page, "NOPE99");
    await expect(page.getByRole("alert")).toHaveText("Code not found");
    await expect(promoInput(page)).toHaveAttribute("aria-invalid", "true");

    await applyCode(page, "OLD15");
    await expect(page.getByRole("alert")).toHaveText("This code has expired");

    await applyCode(page, "SAVE10");
    await expect(page.getByRole("alert")).toHaveText(`Add ${amd(3000 - subtotal)} more to use this code`);
    await expect(anyDiscount).toHaveCount(0);
  });

  test("the applied code and discount are saved on the placed order", async ({ page, request }) => {
    const { email } = await registerCustomerViaApi(request, API);
    const { chefId, dish } = await findChefDish(request, priciest);
    await signIn(page, email, "/orders");
    const subtotal = await fillBasket(page, chefId, dish, Math.ceil(3000 / dish.price));
    await page.goto("/checkout");

    await applyCode(page, "SAVE10");
    await expect(summary(page).discountLine("SAVE10")).toBeVisible();
    // Takeaway keeps the expected total independent of delivery pricing.
    await page.getByText("Takeaway", { exact: true }).click();
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/success\?number=FM-\d+/);
    const number = new URL(page.url()).searchParams.get("number")!;
    const order = await (await request.get(`${API}/api/order/number/${number}`)).json();
    expect(order.promoCode).toBe("SAVE10");
    expect(order.discount).toBeCloseTo(subtotal * 0.1, 2);
    expect(order.totalPrice).toBeCloseTo(subtotal * 0.9, 2);

    // My orders shows the code and what it saved.
    await page.goto("/orders");
    const row = page.getByRole("listitem").filter({ hasText: number });
    await expect(row.getByText(`Saved ${amd(subtotal * 0.1)} with SAVE10`)).toBeVisible();

    // Not remembered after the cart is cleared.
    await fillBasket(page, chefId, dish, 1);
    await page.goto("/checkout");
    await expect(promoInput(page)).toHaveValue("");
    await expect(summary(page).anyDiscount).toHaveCount(0);
  });
});
