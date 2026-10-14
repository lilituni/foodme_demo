import { test, expect, devices, type APIRequestContext, type Page } from "@playwright/test";
import { createAccountAtCheckout, registerCustomerViaApi } from "./auth";

// KAN-9 Cancel order - storefront flow (KAN-13), on desktop and mobile.
const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";

async function adminSetStatus(request: APIRequestContext, number: string, status: string) {
  const login = await request.post(`${API}/admin/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  const { id } = await (await request.get(`${API}/api/order/number/${number}`)).json();
  const res = await request.patch(`${API}/admin/order/${id}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { status },
  });
  expect(res.ok()).toBeTruthy();
}

async function placeOrderViaApi(request: APIRequestContext, token: string) {
  const chefs = await (await request.get(`${API}/api/chef/active?page=0&size=12`)).json();
  const chef = chefs.exploreChefResponseDtoList[0];
  const detail = await (await request.get(`${API}/api/chef/${chef.id}`)).json();
  const res = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      chefId: chef.id,
      receiverName: "Cancel E2E",
      receiverPhoneNumber: "+37495555777",
      receiverEmail: "cancel-e2e@example.com",
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note: "",
      createOrderDishes: [{ dishId: detail.dishes[0].id, quantity: 1 }],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).number as string;
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${next}`);
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("secret123");
  await form.getByRole("button", { name: "Sign in" }).click();
}

// Only viewport/touch/UA - a describe-level test.use() can't switch browser type.
const { defaultBrowserType: _d, ...desktop } = devices["Desktop Chrome"];
const { defaultBrowserType: _m, ...mobile } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: desktop },
  { name: "mobile", use: mobile },
];

for (const vp of viewports) {
  test.describe(`cancel order (${vp.name})`, () => {
    test.use(vp.use);

    test("sign up -> place order -> cancel from My Orders -> shows Cancelled", async ({ page }) => {
      await page.goto("/explore");
      await page.locator("a.cc_card").first().click();
      await expect(page).toHaveURL(/\/chef\/\d+/);

      await page.locator("button.dc_card").first().click();
      await page.getByRole("button", { name: "Add to cart" }).click();
      const cartPanel = page.locator("aside.uc-panel");
      await expect(cartPanel.locator(".cic_root")).toHaveCount(1);
      await cartPanel.getByRole("link", { name: "Go to checkout" }).click();
      await expect(page).toHaveURL(/\/checkout/);

      await createAccountAtCheckout(page, "Cancel Tester");
      const checkout = page.getByRole("form", { name: "Checkout" });
      await checkout.getByLabel("Full name").fill("Cancel Tester");
      await checkout.getByLabel("Phone").fill("+37491234567");
      await checkout.getByLabel("Email").fill("cancel@example.com");
      await page.getByLabel("City").fill("Yerevan");
      await page.getByLabel("Street").fill("Abovyan");
      await page.getByRole("button", { name: "Place order" }).click();

      await expect(page).toHaveURL(/\/orders\/success\?number=FM-\d+/);
      const number = new URL(page.url()).searchParams.get("number")!;

      await page.goto("/orders");
      const card = page.getByRole("listitem").filter({ hasText: number });
      await expect(card.getByText("Received")).toBeVisible();
      await card.getByRole("button", { name: "Cancel order" }).click();

      const dialog = page.getByRole("alertdialog", { name: `Cancel order ${number}?` });
      await expect(dialog.getByText("This can’t be undone.")).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel order" }).click();

      await expect(dialog).toBeHidden();
      await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

      // Tracking: labelled Cancelled, and no progress bar showing it "in progress".
      await page.goto(`/tracking/${number}`);
      await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
    });
  });
}

test.describe("cancel order edge cases", () => {
  test("Keep order leaves the order untouched", async ({ page, request }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const number = await placeOrderViaApi(request, token);
    await signIn(page, email, "/orders");

    const card = page.getByRole("listitem").filter({ hasText: number });
    await card.getByRole("button", { name: "Cancel order" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Keep order" }).click();

    await expect(dialog).toBeHidden();
    await expect(card.getByText("Received")).toBeVisible();
    const order = await (await request.get(`${API}/api/order/number/${number}`)).json();
    expect(order.status).toBe("NEW");
  });

  test("kitchen accepts just before cancel: reason shown, real status refreshed", async ({
    page,
    request,
  }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const number = await placeOrderViaApi(request, token);
    await signIn(page, email, "/orders");

    const card = page.getByRole("listitem").filter({ hasText: number });
    await card.getByRole("button", { name: "Cancel order" }).click();
    // The page still shows "Received" while the kitchen accepts in the background.
    await adminSetStatus(request, number, "ACCEPTED");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel order" }).click();

    await expect(card.getByRole("alert")).toHaveText("Only new orders can be cancelled.");
    await expect(card.getByText("Preparing")).toBeVisible();
    await expect(card.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  });

  test("tracking page: cancel only when signed in, and only while Received", async ({
    page,
    request,
  }) => {
    const { token, email } = await registerCustomerViaApi(request, API);
    const number = await placeOrderViaApi(request, token);

    // Signed out: no cancel option even though the order is still Received.
    await page.goto(`/tracking/${number}`);
    await expect(page.getByText("Order received")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

    await signIn(page, email, `/tracking/${number}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  });
});
