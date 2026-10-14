import { useTranslation } from "react-i18next";
import { formatAmd } from "@/lib/utils";

interface CheckoutPriceSummaryProps {
  subtotal: number;
  deliveryPrice: number;
  freeDeliveryFrom: number;
  /** KAN-11: an applied promo code and the amount it takes off. */
  promo?: { code: string; discount: number } | null;
  isLoading?: boolean;
  isError?: boolean;
  embedded?: boolean;
}

export function CheckoutPriceSummary({
  subtotal,
  deliveryPrice,
  freeDeliveryFrom,
  promo = null,
  isLoading = false,
  isError = false,
  embedded = false,
}: CheckoutPriceSummaryProps) {
  const { t } = useTranslation();
  const total = subtotal + deliveryPrice - (promo?.discount ?? 0);
  const remaining = freeDeliveryFrom - subtotal;

  const body = (
    <div className={embedded ? "space-y-2.5 border-t border-zinc-100 px-5 py-5 text-sm" : "space-y-2.5 p-5 text-sm"}>
      <div className="flex items-center justify-between text-zinc-500">
        <span>Subtotal</span>
        <span className="tabular-nums text-zinc-700">{formatAmd(subtotal)}</span>
      </div>
      <div className="flex items-center justify-between text-zinc-500">
        <span>Delivery</span>
        <span className="tabular-nums text-zinc-700" aria-live="polite">
          {isLoading ? (
            <span className="text-zinc-500">Calculating…</span>
          ) : isError ? (
            <span className="font-semibold text-red-600">Unavailable</span>
          ) : deliveryPrice === 0 ? (
            <span className="font-semibold text-emerald-700">Free</span>
          ) : (
            formatAmd(deliveryPrice)
          )}
        </span>
      </div>
      {promo && (
        <div className="flex items-center justify-between text-emerald-700">
          <span>{t("promo.discount_line", { code: promo.code })}</span>
          <span className="font-semibold tabular-nums">−{formatAmd(promo.discount)}</span>
        </div>
      )}
      {!isLoading && !isError && deliveryPrice > 0 && remaining > 0 && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-100">
          Add {formatAmd(remaining)} more for free delivery.
        </div>
      )}
      <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
        <span className="text-sm font-semibold text-zinc-900">Total</span>
        <span className="text-sm font-semibold tabular-nums text-zinc-900">
          {isLoading || isError ? "—" : formatAmd(total)}
        </span>
      </div>
    </div>
  );

  if (embedded) {
    return <div className="cps_wrap">{body}</div>;
  }

  return (
    <div className="cps_wrap bezel-outer shadow-diffuse">
      <div className="bezel-inner">{body}</div>
    </div>
  );
}
