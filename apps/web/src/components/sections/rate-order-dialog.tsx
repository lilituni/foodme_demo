import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { foodmeApi } from "@/api/foodme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StarRatingInput } from "@/components/sections/star-rating";
import type { FullOrderDto } from "@/types";

const COMMENT_MAX = 1000;

export function RateOrderDialog({
  order,
  open,
  onOpenChange,
}: {
  order: FullOrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      foodmeApi.reviewOrder(order.number, {
        rating: rating as number,
        comment: comment.trim() ? comment.trim() : null,
      }),
    onSuccess: () => {
      // Order lists/tracking show the new review; chef cards show the new average.
      void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["order", order.number] });
      void queryClient.invalidateQueries({ queryKey: ["chef"] });
      void queryClient.invalidateQueries({ queryKey: ["chefs"] });
      onOpenChange(false);
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRating(null);
      setComment("");
      mutation.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-y-auto">
        <form
          aria-label="Rate order"
          className="p-5 md:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (rating != null) mutation.mutate();
          }}
        >
          <DialogTitle className="pr-10 font-display text-xl font-bold text-zinc-900">
            Rate order {order.number}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-zinc-500">
            How was your order from {order.chefName}?
          </DialogDescription>

          <div className="mt-5">
            <StarRatingInput value={rating} onChange={setRating} disabled={mutation.isPending} />
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-semibold text-zinc-900">
              Comment <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={COMMENT_MAX}
              rows={4}
              placeholder="Tell us about your order"
              disabled={mutation.isPending}
              className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 hover:border-zinc-300 focus-visible:border-zinc-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-100 disabled:opacity-50"
            />
            <span className="mt-1 block text-right text-xs tabular-nums text-zinc-400">
              {comment.length}/{COMMENT_MAX}
            </span>
          </label>

          {mutation.isError && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {mutation.error instanceof Error && mutation.error.message
                ? mutation.error.message
                : "Couldn’t save your rating. Please try again."}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={rating == null || mutation.isPending}>
              {mutation.isPending ? "Submitting…" : "Submit rating"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
