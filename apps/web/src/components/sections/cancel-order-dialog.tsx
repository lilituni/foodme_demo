import { useMutation, useQueryClient } from "@tanstack/react-query";
import { foodmeApi } from "@/api/foodme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// KAN-9: confirmation before a customer cancels a still-"Received" order.
export function CancelOrderDialog({
  orderNumber,
  open,
  onOpenChange,
  onRefused,
}: {
  orderNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server refused (e.g. the kitchen accepted it a moment ago). */
  onRefused: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  const refreshOrder = () => {
    void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["order", orderNumber] });
  };

  const mutation = useMutation({
    mutationFn: () => foodmeApi.cancelOrder(orderNumber),
    onSuccess: () => {
      refreshOrder();
      onOpenChange(false);
    },
    onError: (error) => {
      // Re-fetch so the customer sees the order's real status, not a stale "Received".
      refreshOrder();
      onOpenChange(false);
      onRefused(
        error instanceof Error && error.message
          ? error.message
          : "Couldn’t cancel this order. Please try again.",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent role="alertdialog" className="p-5 md:p-6">
        <DialogTitle className="pr-10 font-display text-xl font-bold text-zinc-900">
          Cancel order {orderNumber}?
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-zinc-500">
          This can’t be undone.
        </DialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Keep order
          </Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Cancelling…" : "Cancel order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
