const OrderStatus = {
    NEW: 'NEW',
    ACCEPTED: 'ACCEPTED',
    DELIVERED: 'DELIVERED',
    REJECTED: 'REJECTED',
    // KAN-9: set only by the customer, while the order is still NEW. Final.
    CANCELLED: 'CANCELLED',
};

const OrderStatusColors = {
    [OrderStatus.NEW]: 'info',
    [OrderStatus.ACCEPTED]: 'warning',
    [OrderStatus.DELIVERED]: 'success',
    [OrderStatus.REJECTED]: 'error',
    [OrderStatus.CANCELLED]: 'default',
};

// Display labels. KAN-9 AC-3: a cancelled order is labelled "Cancelled" everywhere;
// the other statuses keep showing their code.
const OrderStatusLabels = {
    [OrderStatus.CANCELLED]: 'Cancelled',
};

const orderStatusLabel = (status) => OrderStatusLabels[status] ?? status;

// Statuses whose totals never count as revenue.
const NonRevenueStatuses = [OrderStatus.REJECTED, OrderStatus.CANCELLED];

// Allowed forward transitions per current status
const OrderStatusTransitions = {
    [OrderStatus.NEW]: [OrderStatus.ACCEPTED, OrderStatus.REJECTED],
    [OrderStatus.ACCEPTED]: [OrderStatus.DELIVERED, OrderStatus.REJECTED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.REJECTED]: [],
    [OrderStatus.CANCELLED]: [],
};

export { OrderStatus, OrderStatusColors, OrderStatusTransitions, NonRevenueStatuses, orderStatusLabel };
