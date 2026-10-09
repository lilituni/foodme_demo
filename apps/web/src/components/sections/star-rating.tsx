import { useId, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

/** Read-only stars, announced to screen readers as "Rated N out of 5". */
export function StarRatingDisplay({
  rating,
  size = 16,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`Rated ${rating} out of 5`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {STARS.map((value) => (
        <Star
          key={value}
          aria-hidden="true"
          size={size}
          strokeWidth={1.75}
          className={value <= rating ? "fill-amber-400 text-amber-400" : "fill-transparent text-zinc-300"}
        />
      ))}
    </span>
  );
}

/**
 * 1-5 star picker built on native radio inputs, so mouse, touch and keyboard
 * (arrow keys within the group) all work and screen readers announce each
 * option and the current choice without extra ARIA wiring.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value ?? 0;

  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold text-zinc-900">Your rating</legend>
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
        {STARS.map((star) => (
          <label
            key={star}
            onMouseEnter={() => setHovered(star)}
            className="group relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zinc-900"
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              className="sr-only"
            />
            <span className="sr-only">{star === 1 ? "1 star" : `${star} stars`}</span>
            <Star
              aria-hidden="true"
              size={30}
              strokeWidth={1.5}
              className={cn(
                "transition-transform duration-150 group-active:scale-90",
                star <= shown ? "fill-amber-400 text-amber-400" : "fill-transparent text-zinc-300",
              )}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
