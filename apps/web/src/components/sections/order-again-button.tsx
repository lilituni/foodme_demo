import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { applyReorder, missingDishesMessage, planReorder, type ReorderPlan } from "@/lib/reorder";
import type { FullOrderDto } from "@/types";

export interface ReorderLocationState {
  reorderNotice?: string;
}

// KAN-10: rebuild the basket from a past order and go to checkout.
export function OrderAgainButton({ order }: { order: FullOrderDto }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<ReorderPlan | null>(null);

  const finish = async (plan: ReorderPlan, replaceOtherChef: boolean) => {
    const result = await applyReorder(plan, { replaceOtherChef });
    if (result === "mismatch") {
      setPendingPlan(plan);
      return;
    }
    const state: ReorderLocationState =
      plan.missing.length > 0 ? { reorderNotice: missingDishesMessage(plan.missing) } : {};
    navigate("/checkout", { state });
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Couldn’t rebuild your basket. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const plan = await planReorder(order);
      if (plan.items.length === 0) {
        // Nothing to add: tell the customer and leave the basket exactly as it is.
        setError("None of these dishes are available anymore");
        return;
      }
      await finish(plan, false);
    });

  const confirmReplace = () => {
    const plan = pendingPlan;
    setPendingPlan(null);
    if (plan) void run(() => finish(plan, true));
  };

  return (
    <div className="flex w-full flex-col items-end gap-2">
      <Button size="sm" variant="outline" onClick={() => void start()} disabled={busy} aria-busy={busy}>
        <RotateCcw strokeWidth={2} className={busy ? "animate-spin" : undefined} />
        {busy ? "Adding to basket…" : "Order again"}
      </Button>
      {error && (
        <p role="alert" className="w-full rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Dialog open={pendingPlan !== null} onOpenChange={(open) => !open && setPendingPlan(null)}>
        <DialogContent role="alertdialog" className="p-5 md:p-6">
          <DialogTitle className="pr-10 font-display text-xl font-bold text-zinc-900">
            Replace your basket?
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-zinc-500">
            Your basket has items from another chef. Replace them?
          </DialogDescription>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPendingPlan(null)}>
              No
            </Button>
            <Button onClick={confirmReplace}>Yes, replace</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
