package am.foodme.backend.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * KAN-11: whether a promo code applies and what the order would cost with it.
 * When {@code applies} is false, {@code reason} says why and the money fields
 * describe the order without a discount.
 */
@Getter
@Setter
@NoArgsConstructor
public class PromoQuoteResponseDto {

    public enum Reason { NOT_FOUND, EXPIRED, BELOW_MINIMUM }

    /** Normalised (upper-case) code. */
    private String code;
    private boolean applies;
    private Reason reason;
    /** English message for API clients; the storefront translates {@code reason} instead. */
    private String message;
    /** Only for BELOW_MINIMUM: how much more the subtotal needs. */
    private Double missingAmount;
    private Integer percentOff;
    private Double subtotal;
    private Double deliveryPrice;
    private Double discount;
    private Double total;
}
