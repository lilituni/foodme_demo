import { test, expect, type APIRequestContext } from "@playwright/test";
import { registerCustomerViaApi } from "./auth";

// KAN-8 Order ratings - storefront flow (R14-R17, R19, R13 tracking).
const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";

async function placeOrder(request: APIRequestContext, token: string) {
  const chefs = await (await request.get(`${API}/api/chef/active?page=0&size=12`)).json();
  const chef = chefs.exploreChefResponseDtoList[0];
  const detail = await (await request.get(`${API}/api/chef/${chef.id}`)).json();
  const res = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      chefId: chef.id,
      receiverName: "Rating E2E",
      receiverPhoneNumber: "+37495555777",
      receiverEmail: "rating-e2e@example.com",
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note: "",
      createOrderDishes: [{ dishId: detail.dishes[0].id, quantity: 1 }],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).number as string;
}

async function markDelivered(request: APIRequestContext, number: string) {
  const login = await request.post(`${API}/admin/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  const { id } = await (await request.get(`${API}/api/order/number/${number}`)).json();
  for (const status of ["ACCEPTED", "DELIVERED"]) {
    const res = await request.patch(`${API}/admin/order/${id}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test("customer rates a delivered order; the rating persists and shows on tracking", async ({
  page,
  request,
}) => {
  const { token, email } = await registerCustomerViaApi(request, API);
  const delivered = await placeOrder(request, token);
  const pending = await placeOrder(request, token);
  await markDelivered(request, delivered);

  await page.goto("/login?next=/orders");
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("secret123");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();

  const deliveredCard = page.getByRole("listitem").filter({ hasText: delivered });
  const pendingCard = page.getByRole("listitem").filter({ hasText: pending });

  // R15: an order that isn't delivered has no rating option.
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard.getByRole("button", { name: "Rate order" })).toHaveCount(0);

  // R14/R16: delivered + unrated -> "Rate order" opens the dialog.
  await deliveredCard.getByRole("button", { name: "Rate order" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Submit rating" })).toBeDisabled();
  // Click the visible star (its <label>), as a user would; the radio itself is sr-only.
  const fourStars = dialog.getByRole("radio", { name: "4 stars" });
  await dialog
    .locator("label", { has: page.getByRole("radio", { name: "4 stars" }) })
    .click();
  await expect(fourStars).toBeChecked();
  await dialog.getByPlaceholder("Tell us about your order").fill("Warm and tasty");
  await dialog.getByRole("button", { name: "Submit rating" }).click();

  // R17: dialog closes, the stars replace the button.
  await expect(dialog).toBeHidden();
  await expect(deliveredCard.getByRole("img", { name: "Rated 4 out of 5" })).toBeVisible();
  await expect(deliveredCard.getByText("Warm and tasty")).toBeVisible();
  await expect(deliveredCard.getByRole("button", { name: "Rate order" })).toHaveCount(0);

  // R19: still there after a reload.
  await page.reload();
  await expect(deliveredCard.getByRole("img", { name: "Rated 4 out of 5" })).toBeVisible();

  // R13: the tracking page shows the rating and comment.
  await page.goto(`/tracking/${delivered}`);
  const rating = page.getByRole("region", { name: "Your rating" });
  await expect(rating.getByRole("img", { name: "Rated 4 out of 5" })).toBeVisible();
  await expect(rating.getByText("Warm and tasty")).toBeVisible();
});
