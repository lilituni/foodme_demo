> **This project:** tracked in Jira (khachatryanlilith.atlassian.net, project KAN) as KAN-10 (subtasks KAN-15, KAN-16).
> The spec below is the original course document; its own links and keys (KAN-6…) point to the course Jira site.

# Spec: "Order again" — reorder a past order in one click (KAN-6)

Jira: [KAN-6](https://foodme-armanayvazyan.atlassian.net/browse/KAN-6), subtasks KAN-15 (backend) and KAN-16 (storefront button and basket rebuild).

## Problem

Repeat customers have to rebuild their basket from scratch every time, even when they order the same thing every week.

## Goal

As a returning customer, I can press **Order again** on a past order and get the same dishes, with the same extras and quantities, straight into my basket, ready to check out.

## Users

- **Returning customer**: signed in, on My Orders or the order tracking page.

## Scope

**In this release**

- Order history knows which menu dish each line came from, and which chef the order was from.
- An **Order again** button on each past order in My Orders and on the order tracking page (when signed in).
- Rebuilding the basket from the old order, using the chef's current menu and today's prices.

**Not in this release**

- Scheduled or recurring orders
- Reordering a single dish from an old order

### Rebuild outcomes

| Situation | What happens |
| --- | --- |
| All dishes still available | Basket is filled, customer goes to checkout |
| Some dishes no longer available | Available dishes are added; message lists the missing ones, e.g. "2 items are no longer available: Philadelphia Classic, Wok Beef." |
| An extra no longer exists | The dish is added without that extra, no message |
| No dish is available | "None of these dishes are available anymore"; basket is not changed |
| Basket has food from a different chef | Ask "Your basket has items from another chef. Replace them?"; **No** leaves everything as it was |

## Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-1 | "Order again" is available on each past order in My Orders and on the order tracking page. |
| AC-2 | Dishes that the chef no longer offers are skipped, and the customer is told which ones. |
| AC-3 | Extras (add-ons) that no longer exist are simply left out. |
| AC-4 | Today's prices are used, not the old ones. |
| AC-5 | If the basket already has food from a different chef, the customer is asked before we replace it. |
| AC-6 | If nothing from the old order is available anymore, the customer is told and the basket is left untouched. |

## Implementation notes (from the subtasks)

### Backend (KAN-15)

- Every line in a customer's order history includes a reference to the original menu dish.
- Each order in the history includes which chef it was from.
- Very old orders whose dish can't be traced are still shown normally, just without the reference.
- Nothing visible changes for customers yet.
- Done when an automated test confirms that, after placing an order, the order history shows the correct dish reference for each line.

### Storefront button and basket rebuild (KAN-16)

Depends on KAN-15.

- Every past order on **My Orders** and on the **order tracking** page (when signed in) has an **Order again** button.
- Pressing it:
  1. Checks each dish from the old order against the chef's current menu.
  2. Adds the dishes that are still available, with the same quantity and the same extras. Extras that no longer exist are left out.
  3. Uses today's prices.
  4. Takes the customer to checkout.
- Messages and the different-chef confirmation follow the rebuild outcomes table above.
- While the basket is being rebuilt, the button shows a loading state and can't be pressed twice.
- Done when an automated end-to-end test covers, on mobile and desktop: sign up → place an order → empty the basket → press Order again → checkout shows the same dishes and quantities.
