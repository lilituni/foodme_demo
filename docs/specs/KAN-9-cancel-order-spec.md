> **This project:** tracked in Jira (khachatryanlilith.atlassian.net, project KAN) as KAN-9 (subtasks KAN-12, KAN-13, KAN-14).
> The spec below is the original course document; its own links and keys (KAN-5…) point to the course Jira site.

# Spec: Let customers cancel an order before the kitchen accepts it (KAN-5)

Jira: [KAN-5](https://foodme-armanayvazyan.atlassian.net/browse/KAN-5), subtasks KAN-12 (backend), KAN-13 (storefront cancel button) and KAN-14 (admin panel).

## Problem

Once a customer places an order, only our team can stop it. Customers who ordered by mistake have to contact us, and kitchens sometimes start cooking food nobody wants.

## Goal

As a customer, if I change my mind right after ordering, I can cancel the order myself as long as the kitchen hasn't accepted it yet.

## Users

- **Customer**: signed in, on My Orders or the order tracking page.
- **Operations (back office)**: sees which orders customers cancelled and is not offered actions that no longer make sense.

## Scope

**In this release**

- A new order status, **Cancelled**.
- The customer who placed an order can cancel it while it is still **Received**.
- A **Cancel order** button, with a confirmation, on My Orders and on the order tracking page.
- The back office shows cancelled orders, can filter by them, and leaves them out of revenue.
- Monitoring counts cancelled orders alongside placed orders.

**Not in this release**

- Cancelling after the kitchen accepts
- Asking the customer for a cancellation reason
- Refunds (orders are cash on delivery)

### Order status rules

| From | Customer can cancel? | Admin can change status? |
| --- | --- | --- |
| Received | yes | yes |
| Accepted or later | no: "Only new orders can be cancelled." | yes |
| Cancelled | no | no: Cancelled is final |

## Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-1 | Customers can cancel their own order only while it is still "Received" (not yet accepted). |
| AC-2 | Once the kitchen accepts it, the cancel option disappears and cancellation is refused. |
| AC-3 | Cancelled orders are clearly labelled "Cancelled" everywhere: My Orders, order tracking and the admin panel. |
| AC-4 | A cancelled order is final: nobody can move it back to any other status. |
| AC-5 | Cancelled orders don't count towards revenue. |

## Implementation notes (from the subtasks)

### Backend (KAN-12)

- Add the order status **Cancelled**.
- Only the customer who placed the order can cancel it. For anyone else, respond as if the order doesn't exist.
- Only orders in "Received" status can be cancelled. Otherwise the response says "Only new orders can be cancelled."
- Cancelled is final: the admin team can't move a cancelled order to any other status.
- Monitoring tracks how many orders get cancelled, alongside how many are placed.
- Done when an automated test covers each of these:
  - the owner cancels a new order
  - trying to cancel an accepted order
  - trying to cancel someone else's order
  - not signed in
  - an admin trying to change a cancelled order

### Storefront cancel button (KAN-13)

Depends on KAN-12.

- On **My Orders** and on the **order tracking** page, orders in "Received" status show a **Cancel order** button. On the tracking page, only when the customer is signed in.
- Clicking it asks "Cancel order FM-xxxxxx? This can't be undone." with **Keep order** / **Cancel order** choices.
- After cancelling, the order shows the status **Cancelled** in a neutral grey style, different from the red "Declined".
- If the kitchen accepted the order just before the customer pressed cancel, the page shows the reason and refreshes the order so the customer sees its real status.
- The tracking progress bar does not show a cancelled order as "in progress".
- Done when an automated end-to-end test covers, on mobile and desktop: sign up → place an order → cancel it from My Orders → it shows "Cancelled".

### Admin panel (KAN-14)

Depends on KAN-12, can be worked on in parallel.

- "Cancelled" appears as its own status with its own colour in the order list and order details.
- The order list can be filtered to show only cancelled orders.
- A cancelled order shows the note "Cancelled by customer" and has no Accept / Deliver / Reject buttons.
- Dashboard revenue figures don't include cancelled or declined orders.
- Done when all of the above is visible in the admin panel and all automated checks pass.
