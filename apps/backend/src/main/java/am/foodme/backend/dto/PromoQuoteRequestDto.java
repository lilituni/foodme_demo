package am.foodme.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** KAN-11: what checkout sends to price a promo code. */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PromoQuoteRequestDto {
    private String code;
    private Long chefId;
    private Double subtotal;
    /** DELIVERY | TAKEAWAY */
    private String deliveryMethod;
}
