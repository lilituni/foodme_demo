import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmd } from "@/lib/utils";
import type { PromoQuoteResponse } from "@/types";

// KAN-11: promo code entry in the checkout summary. The parent owns which code is
// applied and the server quote for it; this only renders the field and messages.
export function PromoCodeField({
  quote,
  isChecking,
  isError,
  onApply,
  onRemove,
}: {
  quote: PromoQuoteResponse | undefined;
  isChecking: boolean;
  isError: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const messageId = useId();
  const [value, setValue] = useState("");

  const rejection = quote && !quote.applies && quote.reason
    ? t(`promo.errors.${quote.reason}`, { amount: formatAmd(quote.missingAmount ?? 0) })
    : isError
      ? t("promo.errors.generic")
      : null;

  return (
    <div className="border-t border-zinc-100 px-5 py-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onApply(value.trim());
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-semibold text-zinc-900">
            {t("promo.label")}
          </label>
          <Input
            id={inputId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("promo.placeholder")}
            autoComplete="off"
            autoCapitalize="characters"
            aria-invalid={rejection ? true : undefined}
            aria-describedby={rejection || quote?.applies ? messageId : undefined}
          />
        </div>
        <Button type="submit" variant="outline" disabled={isChecking || !value.trim()}>
          {isChecking ? t("promo.applying") : t("promo.apply")}
        </Button>
      </form>

      {rejection && (
        <p id={messageId} role="alert" className="mt-2 text-sm text-red-700">
          {rejection}
        </p>
      )}
      {quote?.applies && (
        <div id={messageId} className="mt-2 flex items-center justify-between gap-2" role="status">
          <span className="text-sm font-medium text-emerald-700">
            {t("promo.applied", { code: quote.code, percent: quote.percentOff })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("promo.remove")}
            onClick={() => {
              setValue("");
              onRemove();
            }}
          >
            <X strokeWidth={2} />
          </Button>
        </div>
      )}
    </div>
  );
}
