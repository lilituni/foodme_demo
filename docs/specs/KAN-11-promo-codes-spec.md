> **This project:** tracked in Jira (khachatryanlilith.atlassian.net, project KAN) as KAN-11 (subtasks KAN-17, KAN-18).
> The spec below is the original course document; its own links and keys (KAN-27…) point to the course Jira site.

# Spec: Apply a promo code at checkout (KAN-27)

Jira: [KAN-27](https://foodme-armanayvazyan.atlassian.net/browse/KAN-27), subtasks KAN-28 (backend) and KAN-29 (checkout UI).

## Problem

Marketing wants to run simple percentage promotions. Today there is no way for a customer to get a discount at checkout.

## Goal

As a customer, I want to apply a promo code at checkout so that I pay less.

## Users

- **Customer**: signed in, on the storefront checkout page.
- **Marketing**: defines the launch codes. In this release they can't manage codes in the back office.

## Scope

**In this release**

- A **Promo code** field and an **Apply** button in the checkout order summary.
- The server validates and prices the code.
- The server checks the code again when the order is placed, and saves the code and the discount on the order.
- The launch codes below, added by a database migration.

**Not in this release**

- Free-delivery codes
- Chef-specific codes
- First-order-only codes
- Admin screens for managing codes
- Remembering a code across sessions or after the cart is cleared

### Launch codes

| Code | Discount | Minimum order | Status |
| --- | --- | --- | --- |
| SAVE10 | 10% | 3,000 AMD | valid |
| TREAT15 | 15% | 8,000 AMD | valid |
| OLD15 | 15% | none | expired |

## Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-1 | On the checkout page, the customer can enter a promo code and press **Apply**. |
| AC-2 | A valid code reduces the subtotal by the code's percentage. The discount and the new total are shown before the order is placed. |
| AC-3 | A code works only if the subtotal is at least the code's minimum order amount. Otherwise the page shows "Add {missing amount} AMD more to use this code". |
| AC-4 | An expired code shows "This code has expired". |
| AC-5 | An unknown code shows "Code not found". |
| AC-6 | One code per order. Applying a second code replaces the first. |
| AC-7 | The customer can remove the applied code, and the total goes back to the original. |

## Implementation notes (from the subtasks)

### Backend (KAN-28)

- The checkout page sends the code, the chef, the cart subtotal and the delivery method. The response says whether the code applies, and gives the discount, the delivery fee and the new total.
- A rejected code comes back with a reason: not found, expired, or below the code's minimum. A below-minimum response includes the missing amount.
- The discount is calculated on the order total including the delivery fee.
- When the order is placed with a code, the server checks the code again and saves the code and the discount on the order.
- Done when an automated test covers each of these:
  - applying a valid code
  - a code below its minimum
  - an expired code
  - an unknown code
  - placing an order with a code

### Checkout UI (KAN-29)

- When a code applies, the summary shows a discount line with the code and the amount, and the **Total** updates before the order is placed.
- When a code doesn't apply, the field shows one of the AC-3, AC-4 or AC-5 messages.
- A **Remove promo code** button takes the code off.
- All text goes through translations.
- No test ids. The field has a visible label, and the buttons have accessible names.
- Done when an automated test covers this flow, on mobile and desktop:
  1. Apply a valid code.
  2. See the discount and the new total.
  3. Replace it with another code.
  4. Remove it.
