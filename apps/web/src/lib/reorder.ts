import { ApiRequestError } from "@/api/client";
import { foodmeApi } from "@/api/foodme";
import { db } from "@/lib/db";
import { addDishToCart, clearCart, getCartChefId } from "@/hooks/useCart";
import type { DishDto, FullOrderDto } from "@/types";

// KAN-10 "Order again": rebuild the basket from a past order against the chef's
// *current* menu. The old order is only used for which dishes, extras and
// quantities - never for prices.

export interface ReorderPlan {
  chefId: number;
  /** Dishes still on the menu, carrying only the extras that still exist, at today's prices. */
  items: { dish: DishDto; quantity: number }[];
  /** Names of dishes from the old order that the chef no longer offers. */
  missing: string[];
}

export async function planReorder(order: FullOrderDto): Promise<ReorderPlan> {
  let menu: DishDto[] = [];
  try {
    const chef = await foodmeApi.getChefById(order.chefId);
    if (chef.status === "ACTIVE") {
      menu = (chef.dishes ?? []).filter((d) => d.status === "ACTIVE");
    }
  } catch (error) {
    // A chef that no longer exists simply has nothing available.
    if (!(error instanceof ApiRequestError && error.status === 404)) throw error;
  }

  const plan: ReorderPlan = { chefId: order.chefId, items: [], missing: [] };
  for (const line of order.orderDishList) {
    // Legacy lines without a dish reference can't be matched to the menu.
    const current = line.dishId != null ? menu.find((d) => d.id === line.dishId) : undefined;
    if (!current) {
      plan.missing.push(line.nameEn);
      continue;
    }
    // Extras are snapshotted by name on the order; keep those the dish still offers.
    const additions = (line.additions ?? [])
      .map((old) => current.additions?.find((a) => a.nameEn === old.nameEn))
      .filter((a): a is NonNullable<typeof a> => a !== undefined);
    plan.items.push({
      dish: { ...current, chefId: order.chefId, additions },
      quantity: line.quantity,
    });
  }
  return plan;
}

/**
 * Puts the plan into the basket. Returns "mismatch" without touching anything when
 * the basket holds another chef's food and the customer hasn't agreed to replace it.
 */
export async function applyReorder(
  plan: ReorderPlan,
  options?: { replaceOtherChef?: boolean },
): Promise<"ok" | "mismatch"> {
  return db.transaction("rw", db.products, async () => {
    const basketChefId = await getCartChefId();
    if (basketChefId !== undefined && basketChefId !== plan.chefId) {
      if (!options?.replaceOtherChef) return "mismatch";
      await clearCart();
    }
    for (const { dish, quantity } of plan.items) {
      await addDishToCart(dish, quantity);
    }
    return "ok";
  });
}

export function missingDishesMessage(missing: string[]): string {
  const count = missing.length;
  return `${count} ${count === 1 ? "item is" : "items are"} no longer available: ${missing.join(", ")}.`;
}
